#!/bin/sh
# StormBrain - dependency installer (Flask build).
# Installs Python 3 + the pip requirements. ngrok itself is downloaded
# automatically by pyngrok, so no manual ngrok binary is needed.

set -u

if [ -f .ascii ]; then
    cat .ascii
fi

GRN='\033[0;32m'
RED='\033[0;31m'
BLU='\033[0;34m'
RST='\033[0m'

fail() {
    printf "${RED}[!] %s\n${RST}" "$1"
    exit 1
}

info() {
    printf "${BLU}[*] %s\n${RST}" "$1"
}

install_python() {
    if [ -n "${PREFIX:-}" ] && echo "$PREFIX" | grep -q com.termux; then
        info "Android / Termux detected"
        pkg install -y python || fail "pkg install failed"
        return
    fi

    KERNEL="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$KERNEL" in
        linux)
            [ "$(id -u)" -eq 0 ] || fail "Please run as root: sudo bash install.sh"
            if command -v apt-get >/dev/null 2>&1; then
                apt-get update && apt-get install -y python3 python3-pip
            elif command -v pacman >/dev/null 2>&1; then
                pacman -Sy --noconfirm python python-pip
            elif command -v dnf >/dev/null 2>&1; then
                dnf install -y python3 python3-pip
            elif command -v yum >/dev/null 2>&1; then
                yum install -y python3 python3-pip
            elif command -v emerge >/dev/null 2>&1; then
                emerge -av dev-lang/python dev-python/pip
            else
                fail "Unsupported package manager - install python3 and pip manually"
            fi
            ;;
        darwin)
            command -v brew >/dev/null 2>&1 || fail "Install Homebrew first (https://brew.sh)"
            brew install python
            ;;
        *)
            fail "Unsupported system ($KERNEL) - install python3 and pip manually"
            ;;
    esac
}

install_requirements() {
    info "Installing python requirements..."
    PYV="$(python3 --version 2>/dev/null | grep -oE '\.[0-9]+\.' | tr -d '.')"
    if [ -n "${PYV:-}" ] && [ "$PYV" -ge 11 ]; then
        python3 -m pip install --break-system-packages -r requirements.txt \
            || fail "pip install failed"
    else
        python3 -m pip install -r requirements.txt || fail "pip install failed"
    fi
}

install_python
install_requirements

printf "\n${GRN}[+] Dependencies installed successfully.${RST}\n"
printf "${GRN}[+] Next: python3 st.py  (enter your ngrok token once, or export NGROK_AUTHTOKEN)${RST}\n\n"
exit 0
