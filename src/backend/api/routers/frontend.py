from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

router = APIRouter()

FRONTEND_DIR = Path(__file__).parent.parent.parent.parent / "frontend"
FRONTEND_PUBLIC = FRONTEND_DIR / "public"

_css_dir = FRONTEND_DIR / "css"
_js_dir = FRONTEND_DIR / "js"
_lib_dir = FRONTEND_DIR / "lib"


def register_static(app: FastAPI) -> None:
    """Serve static assets: CSS, JS, and vendor libraries."""
    if _css_dir.exists():
        app.mount("/static/css", StaticFiles(directory=str(_css_dir)), name="static-css")
    if _js_dir.exists():
        app.mount("/static/js", StaticFiles(directory=str(_js_dir)), name="static-js")
    if _lib_dir.exists():
        app.mount("/static/lib", StaticFiles(directory=str(_lib_dir)), name="static-lib")
    if FRONTEND_PUBLIC.exists():
        app.mount("/static/public", StaticFiles(directory=str(FRONTEND_PUBLIC)), name="static-public")


def get_frontend_dir():
    return FRONTEND_PUBLIC


# ── SPA fallback (must be last — catches all unmatched paths) ─────────────

# index.html must never be cached by the browser: it's the one file that
# references the versioned assets (app.js?v=NN, style.css?v=NN). If a stale
# copy is served, the browser keeps requesting old asset versions and never
# sees new deploys. no-store forces a fresh fetch every load; the versioned
# JS/CSS underneath can still be cached hard.
_INDEX_NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}


def _html_response(frontend, filename: str) -> FileResponse:
    return FileResponse(str(frontend / filename), headers=_INDEX_NO_CACHE)


@router.get("/")
def serve_landing():
    return _html_response(get_frontend_dir(), "landing.html")


@router.get("/app")
def serve_app():
    return _html_response(get_frontend_dir(), "app.html")


@router.get("/{path_name:path}")
def serve_spa_fallback(path_name: str):
    frontend = get_frontend_dir()
    file_path = (frontend / path_name).resolve()
    if file_path.is_relative_to(frontend.resolve()) and file_path.is_file():
        return FileResponse(str(file_path))
    return _html_response(frontend, "app.html")
