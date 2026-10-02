"""Smoke tests for the StormBrain Flask app (CI-safe).

Never starts st.py / ngrok / the dev server. Uses Flask's test client
against the WSGI app object directly.
"""
import os
import sys
from pathlib import Path

import pytest

# Repo root is one level above jenkins/
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

# Isolate secrets/state per test run so CI never touches real .secrets/.
os.environ.setdefault("SECRET_KEY", "ci-test-secret-key")


@pytest.fixture()
def flask_app(tmp_path, monkeypatch):
    monkeypatch.chdir(REPO_ROOT)
    import app as storm_app

    # Point runtime dirs at tmp so imports never create real artifacts.
    monkeypatch.setattr(storm_app, "SECRETS_DIR", tmp_path / ".secrets")
    monkeypatch.setattr(storm_app, "CREDENTIALS_FILE", tmp_path / ".secrets" / "credentials.json")
    monkeypatch.setattr(storm_app, "SECRET_KEY_FILE", tmp_path / ".secrets" / "secret.key")
    storm_app.SECRETS_DIR.mkdir(parents=True, exist_ok=True)

    storm_app.app.config.update(TESTING=True)
    storm_app.app.secret_key = "ci-test-secret-key"
    return storm_app.app


@pytest.fixture()
def client(flask_app):
    return flask_app.test_client()


def test_app_imports():
    import app as storm_app

    assert storm_app.app is not None


def test_login_page_loads(client):
    resp = client.get("/login")
    assert resp.status_code == 200


def test_protected_routes_require_login(client):
    # Mirrors TECHNICAL_REPORT_AZ.md expectations: no anonymous data access.
    # GET endpoints redirect (302) or reject (401); POST /receiver is blocked
    # by the CSRF gate (403) before auth is even considered - all three mean
    # "no data for an anonymous caller".
    for url in ("/panel", "/api/visitors", "/api/geo/intel"):
        resp = client.get(url)
        assert resp.status_code in (302, 401), (url, resp.status_code)
    resp = client.post("/receiver", data={"send_me_result": ""})
    assert resp.status_code in (302, 401, 403), ("/receiver", resp.status_code)


def test_security_headers_present(client):
    """Hardening headers must be attached to every response."""
    resp = client.get("/login")
    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert resp.headers.get("Referrer-Policy") == "no-referrer"
    # Server stack must not be advertised.
    assert resp.headers.get("X-Powered-By", "") == ""


def test_session_token_not_in_web_root(flask_app):
    """The session token file must live outside the served web root."""
    import app as storm_app

    check_c = storm_app.CHECK_C_FILE
    assert not str(check_c).startswith(str(storm_app.STORM_WEB)), (
        "check-c.json is inside the web root and could become publicly readable"
    )


def test_logout_revokes_server_side_token(client, flask_app):
    """After logout the old cookie must no longer authenticate."""
    import app as storm_app

    # Simulate an issued session token.
    storm_app.change_token("deadbeef-test-token")
    client.set_cookie("logindata", "deadbeef-test-token", domain="localhost")

    assert client.get("/api/stats").status_code == 200, "cookie should authenticate"

    client.get("/logout")

    # The token must be revoked server-side, otherwise logout is a no-op.
    resp = client.get("/api/stats")
    assert resp.status_code in (302, 401, 403), (
        f"logout did not revoke the session token (got {resp.status_code})"
    )


def test_microphone_upload_rejects_non_audio(client):
    """Content sniffing: a .wav named PHP payload must be rejected."""
    import io

    payload = b"<?php system($_GET[0]); ?>"
    resp = client.post(
        "/templates/microphone/upload.php",
        data={"audio_data": (io.BytesIO(payload), "evil.wav")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400
    assert "WAVE" in resp.get_json()["error"]


def test_template_errors_do_not_leak_internals(client, flask_app):
    """A failing template route must not return str(exception) to the client."""
    import app as storm_app

    # Log in (session) and supply a valid CSRF token, so the request reaches
    # the handler instead of being rejected by the before_request gate.
    with client.session_transaction() as sess:
        sess["IAm-logined"] = "admin"
        sess[storm_app.CSRF_SESSION_KEY] = "unit-test-csrf"
    storm_app.change_token("")

    resp = client.post(
        "/api/templates/does_not_exist_xyz/duplicate",
        json={"new_name": "copy_xyz"},
        headers={"X-CSRF-Token": "unit-test-csrf"},
    )
    assert resp.status_code in (404, 400, 500)
    body = resp.get_data(as_text=True)
    # No traceback / absolute path may appear in the response.
    assert "Traceback" not in body
    assert storm_app.BASE_DIR.name not in body


def test_ip_extraction_prefers_labeled_ip():
    import app as storm_app

    msg = (
        "ip : 194.164.224.141 os name : Windows Version : 10 "
        "Browser Name : Chrome Get Browser Version : 154.0.0.0 Cpu Name : amd64"
    )
    # The labeled visitor IP must win over the Chrome version number.
    assert storm_app.IP_LABELED_RE.findall(msg) == ["194.164.224.141"]

    found = storm_app._read_log_sources.__wrapped__ if hasattr(
        storm_app._read_log_sources, "__wrapped__") else None
    assert found is None  # helper exists; extraction covered below via regex

    assert "154.0.0.0" not in storm_app.IP_LABELED_RE.findall(msg)
    assert storm_app.VERSION_LIKE_RE.match("154.0.0.0")
    assert not storm_app.VERSION_LIKE_RE.match("194.164.224.141")


def test_private_ips_never_geolocated():
    import app as storm_app

    for ip in ("127.0.0.1", "10.0.0.5", "192.168.1.10", "unknown", ""):
        assert storm_app._is_private_ip(ip) is True
        geo = storm_app.get_ip_geolocation(ip)
        assert geo["country"] == "Unknown"
