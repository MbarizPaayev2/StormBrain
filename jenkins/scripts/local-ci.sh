#!/bin/sh
# Local replica of the Jenkins pipeline for Windows (Git Bash) / Linux shells.
# Usage: sh jenkins/scripts/local-ci.sh
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VENV="${VENV_DIR:-.venv-jenkins}"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
. "$VENV/bin/activate" 2>/dev/null || . "$VENV/Scripts/activate"
pip install -U pip -q
pip install -r requirements.txt -q
pip install -r jenkins/requirements-ci.txt -q
python -m py_compile app.py modules/*.py jenkins/tests/*.py
ruff check app.py modules/ jenkins/tests/ || true
node --check storm-web/assets/js/dashboard.js
node --check storm-web/assets/js/sb.js
node --check storm-web/assets/js/stormmap.js
bash -n install.sh
pytest jenkins/tests -q
echo "[+] local-ci OK"
