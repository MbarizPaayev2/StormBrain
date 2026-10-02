import os
import json
import time
from pathlib import Path

import psutil
from pyngrok import ngrok
from colorama import Fore, Style

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TOKEN_PATH = PROJECT_ROOT / ".secrets" / "ngrok.json"
LEGACY_SETTINGS_PATH = PROJECT_ROOT / "storm-web" / "Settings.json"


def save_token(token):
    """Save the ngrok auth token outside the web root (never served, gitignored)."""
    try:
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(TOKEN_PATH, "w") as f:
            json.dump({"ngrok_token": token}, f, indent=2)
        try:
            os.chmod(TOKEN_PATH, 0o600)
        except OSError:
            pass
    except Exception:
        pass


def _migrate_legacy_token():
    """Move a token that older versions stored in storm-web/Settings.json."""
    try:
        with open(LEGACY_SETTINGS_PATH, "r") as f:
            legacy = json.load(f)
    except Exception:
        return ""

    token = legacy.get("ngrok_token", "") if isinstance(legacy, dict) else ""
    if not token:
        return ""

    save_token(token)
    legacy.pop("ngrok_token", None)
    try:
        with open(LEGACY_SETTINGS_PATH, "w") as f:
            json.dump(legacy, f)
    except Exception:
        pass
    print(Fore.YELLOW + " [i] Moved the ngrok token to .secrets/ngrok.json" + Style.RESET_ALL)
    return token


def _find_system_ngrok_token():
    """Look for an already configured ngrok authtoken in standard ngrok config locations."""
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "ngrok" / "ngrok.yml",
        Path(os.environ.get("USERPROFILE", "")) / ".config" / "ngrok" / "ngrok.yml",
        Path(os.environ.get("USERPROFILE", "")) / ".ngrok2" / "ngrok.yml",
        Path.home() / ".config" / "ngrok" / "ngrok.yml",
        Path.home() / ".ngrok2" / "ngrok.yml",
    ]
    import re
    for p in candidates:
        if p and p.exists():
            try:
                content = p.read_text(encoding="utf-8")
                m = re.search(r"authtoken:\s*([^\s\r\n]+)", content)
                if m:
                    found = m.group(1).strip("\"'")
                    if found:
                        save_token(found)
                        return found
            except Exception:
                pass
    return ""


def get_saved_token():
    """Retrieve the saved ngrok auth token (env var first, then .secrets/ngrok.json, then system config)."""
    env_token = os.environ.get("NGROK_AUTHTOKEN")
    if env_token:
        return env_token

    if TOKEN_PATH.exists():
        try:
            with open(TOKEN_PATH, "r") as f:
                data = json.load(f)
            token = data.get("ngrok_token", "")
            if token:
                return token
        except Exception:
            pass

    token = _migrate_legacy_token()
    if token:
        return token

    return _find_system_ngrok_token()


def setup_auth_token():
    """Retrieve saved ngrok auth token or prompt only once if missing."""
    token = get_saved_token()
    if token:
        print(Fore.GREEN + " [+] Using stored Ngrok Auth-Token." + Style.RESET_ALL)
    else:
        print(Fore.LIGHTCYAN_EX + " [!] No Ngrok Auth-Token found." + Style.RESET_ALL)
        token = input(Fore.YELLOW + " [>] Please enter your Ngrok Auth-Token: " + Style.RESET_ALL).strip()
        if token:
            save_token(token)
            print(Fore.GREEN + " [+] Ngrok Auth-Token saved permanently!\n" + Style.RESET_ALL)

    if token:
        try:
            ngrok.set_auth_token(token)
        except Exception as e:
            print(Fore.RED + f" [!] Error setting token: {e}" + Style.RESET_ALL)
    return token


def kill_all_ngrok_processes():
    """Forcefully kill any running ngrok processes on the system."""
    try:
        ngrok.kill()
    except Exception:
        pass

    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] and 'ngrok' in proc.info['name'].lower():
                proc.kill()
        except Exception:
            pass
    time.sleep(1)


def start_tunnel(port=2525, auth_token=None):
    """
    Start an ngrok HTTP tunnel on the given port.
    Returns the public HTTPS URL.
    """
    kill_all_ngrok_processes()

    if auth_token:
        try:
            ngrok.set_auth_token(auth_token)
        except Exception:
            pass

    try:
        tunnel = ngrok.connect(port, "http")
        public_url = tunnel.public_url

        # Force HTTPS
        if public_url.startswith("http://"):
            public_url = public_url.replace("http://", "https://")

        print(Fore.GREEN + "\n [+] Ngrok Tunnel Active!" + Style.RESET_ALL)
        print(Fore.RED + " [+] " + Fore.WHITE + f"Public URL : {public_url}" + Style.RESET_ALL)
        print(Fore.YELLOW + " [+] " + f"Send this link to target!\n" + Style.RESET_ALL)

        return public_url

    except Exception as e:
        print(Fore.RED + f"\n [!] Ngrok error: {e}" + Style.RESET_ALL)
        print(Fore.YELLOW + " [*] Tool will still work on localhost." + Style.RESET_ALL)
        print(Fore.YELLOW + " [*] To use ngrok, set auth token: NGROK_AUTHTOKEN=your_token" + Style.RESET_ALL)
        return None


def stop_tunnel():
    """Kill all ngrok tunnels."""
    kill_all_ngrok_processes()
