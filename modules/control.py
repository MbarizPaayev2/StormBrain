"""Terminate server processes recorded from a previous (possibly crashed) run."""

import json
import platform
import subprocess
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parent.parent / "storm-web" / "Settings.json"


def kill_stale_processes():
    """Kill the PIDs from the last run (works on Windows and Unix)."""
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return

    for raw_pid in data.get("pid", []):
        try:
            pid = int(raw_pid)
        except (TypeError, ValueError):
            continue
        if pid <= 0:
            continue
        command = f"taskkill /PID {pid} /F" if platform.system() == "Windows" else f"kill -9 {pid}"
        try:
            subprocess.getoutput(command)
        except Exception:
            pass

    data["pid"] = []
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass

