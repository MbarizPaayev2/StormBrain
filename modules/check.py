"""Dependency check and runtime state handling."""

import json
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = PROJECT_ROOT / "storm-web" / "Settings.json"

# Distribution name -> import name (kept in sync with requirements.txt)
PACKAGES = {
    "flask": "flask",
    "flask-socketio": "flask_socketio",
    "colorama": "colorama",
    "requests": "requests",
    "psutil": "psutil",
    "pyngrok": "pyngrok",
}


def dependency():
    """Verify every runtime dependency and install what is missing."""
    import sys

    missing = []
    for dist_name, import_name in PACKAGES.items():
        try:
            __import__(import_name)
        except ImportError:
            missing.append(dist_name)

    if not missing:
        return

    print(f"[*] Installing missing dependencies: {', '.join(missing)}...")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", *missing]
        )
        print("[+] All dependencies installed successfully!")
    except Exception as exc:
        print(f"[!] Failed to auto-install dependencies: {exc}")
        sys.exit(1)


def _read_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"pid": [], "is_start": False, "version": 3.0}


def check_started():
    """Mark the run as started and clean up processes left over from a crash."""
    data = _read_settings()

    if data.get("is_start"):
        from modules import control
        control.kill_stale_processes()

    data["is_start"] = True
    try:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError as exc:
        print(f"[!] Could not update {SETTINGS_PATH}: {exc}")

