"""Per-launch session isolation.

``st.py`` calls :func:`start_new_session` on every start: the artifacts of the
previous run are *moved* (never deleted) into

    storm-web/sessions/<YYYYmmdd-HHMMSS>/

so the panel always starts with an empty, single-run data set, while the old
captures stay on disk and remain readable from the panel (``/api/sessions``).

Layout of an archived session::

    <session>/session.json          manifest (counts, timestamps)
    <session>/images/*              webcam captures of that run
    <session>/sounds/*              microphone recordings of that run
    <session>/visitors/visitors.json
    <session>/log/activity.json
    <session>/results/<template>.txt

The ``storm-web/sessions/`` tree is gitignored and is not exposed by any static
route - archived media is only reachable through the authenticated
``/sessions/<id>/<kind>/<file>`` endpoint.
"""

import json
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STORM_WEB = PROJECT_ROOT / "storm-web"
SESSIONS_DIR = STORM_WEB / "sessions"

SESSION_ID_RE = re.compile(r"^\d{8}-\d{6}$")

# Repo-tracked placeholders keep the (otherwise empty) data directories in git.
PLACEHOLDER_NAMES = {"image.log", "sounds.log", "empty", ".gitkeep"}
RESULT_NAMES = ("result.txt", "result.tmp.txt")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif")
AUDIO_SUFFIXES = (".wav", ".mp3", ".ogg")


def _files(directory, names=None):
    """Return the archivable files of a directory (placeholders skipped)."""
    if not directory.is_dir():
        return []
    found = []
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.name in PLACEHOLDER_NAMES:
            continue
        if path.name.endswith(".tmp"):
            continue
        if names is not None and path.name not in names:
            continue
        found.append(path)
    return found


def _collect():
    """Return ``(moves, counts)`` for the artifacts of the current run."""
    moves = []
    counts = {"images": 0, "sounds": 0, "visitors": 0, "activity": 0, "results": 0}

    for path in _files(STORM_WEB / "images"):
        moves.append((path, Path("images") / path.name))
        counts["images"] += 1

    for path in _files(STORM_WEB / "sounds"):
        moves.append((path, Path("sounds") / path.name))
        counts["sounds"] += 1

    for path in _files(STORM_WEB / "visitors"):
        moves.append((path, Path("visitors") / path.name))
        counts["visitors"] += 1

    for path in _files(STORM_WEB / "log", names={"activity.json", "events.jsonl"}):
        moves.append((path, Path("log") / path.name))
        counts["activity"] += 1

    templates_dir = STORM_WEB / "templates"
    if templates_dir.is_dir():
        for template_dir in sorted(templates_dir.iterdir()):
            if not template_dir.is_dir():
                continue
            for path in _files(template_dir, names=set(RESULT_NAMES)):
                moves.append((path, Path("results") / f"{template_dir.name}.txt"))
                counts["results"] += 1

    return moves, counts


def _move(source, target):
    """Move a file, falling back to copy+delete when it crosses filesystems."""
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(source), str(target))
    except OSError:
        shutil.copy2(str(source), str(target))
        try:
            source.unlink()
        except OSError:
            pass


# ──────────────────────────────────────────────
# Session lifecycle
# ──────────────────────────────────────────────

def _unique_session_id():
    """Timestamp id (YYYYmmdd-HHMMSS), shifted by one second when already taken."""
    moment = datetime.now()
    for offset in range(0, 120):
        session_id = (moment + timedelta(seconds=offset)).strftime("%Y%m%d-%H%M%S")
        if not (SESSIONS_DIR / session_id).exists():
            return session_id
    return moment.strftime("%Y%m%d-%H%M%S")


def start_new_session(force=False):
    """Archive the artifacts of the previous run.

    :param force: create the session folder even when there is nothing to move.
    :returns: the new session id, or ``None`` when there was nothing to archive.
    """
    moves, counts = _collect()
    if not moves and not force:
        return None

    session_id = _unique_session_id()
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    moved = 0
    total_bytes = 0
    stamps = []

    for source, relative in moves:
        try:
            size = source.stat().st_size
            mtime = source.stat().st_mtime
            _move(source, session_dir / relative)
        except OSError:
            continue
        moved += 1
        total_bytes += size
        stamps.append(mtime)

    if not moved and not force:
        try:
            session_dir.rmdir()
        except OSError:
            pass
        return None

    manifest = {
        "id": session_id,
        "archived_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "first_capture": datetime.fromtimestamp(min(stamps)).strftime("%Y-%m-%d %H:%M:%S") if stamps else "",
        "last_capture": datetime.fromtimestamp(max(stamps)).strftime("%Y-%m-%d %H:%M:%S") if stamps else "",
        "files": moved,
        "bytes": total_bytes,
        "counts": counts,
    }
    (session_dir / "session.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return session_id


def _read_manifest(directory):
    try:
        data = json.loads((directory / "session.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def list_sessions():
    """Return the manifests of all archived sessions, newest first."""
    if not SESSIONS_DIR.is_dir():
        return []

    sessions = []
    for directory in SESSIONS_DIR.iterdir():
        if not directory.is_dir() or not SESSION_ID_RE.match(directory.name):
            continue
        manifest = _read_manifest(directory)
        if manifest is None:
            manifest = {"id": directory.name, "archived_at": "", "files": 0, "counts": {}}
        manifest.setdefault("id", directory.name)
        sessions.append(manifest)

    sessions.sort(key=lambda item: item.get("id", ""), reverse=True)
    return sessions


def session_dir(session_id):
    """Return the directory of an archived session, or ``None`` when unknown."""
    if not SESSION_ID_RE.match(session_id or ""):
        return None
    directory = SESSIONS_DIR / session_id
    return directory if directory.is_dir() else None


def session_media(session_id):
    """List the captures of an archived session (``None`` when unknown)."""
    directory = session_dir(session_id)
    if directory is None:
        return None

    media = []
    for kind, folder, suffixes in (
        ("image", "images", IMAGE_SUFFIXES),
        ("audio", "sounds", AUDIO_SUFFIXES),
    ):
        for path in _files(directory / folder):
            if path.suffix.lower() not in suffixes:
                continue
            media.append({
                "type": kind,
                "filename": path.name,
                "timestamp": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "size": path.stat().st_size,
                "url": f"/sessions/{session_id}/{folder}/{path.name}",
            })

    media.sort(key=lambda item: item["timestamp"], reverse=True)
    return media
