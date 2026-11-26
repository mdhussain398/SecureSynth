from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import errors
from app.config import Settings
from app.routers import admin, auth, bank, device, investigation
from app.services.sessions import MUTATING
from app.state import AppState


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="SecureSynth API", version="1.1.0",
                  description="Risk-based authentication & ATO detection prototype. Synthetic data only.")
    app.state.ss = AppState.build(settings)
    errors.install(app)

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method in MUTATING and origin and origin not in settings.allowed_origins:
            return JSONResponse(errors.error_body("ORIGIN_REJECTED", "Origin not allowed."), status_code=403)
        import secrets as _secrets
        from app.services import clock as _clock
        lab_tok = request.headers.get("x-lab-token")
        is_lab = bool(settings.demo_mode and lab_tok and _secrets.compare_digest(lab_tok, app.state.ss.lab_token))
        mark = _clock.mark_lab_request(is_lab)
        try:
            response = await call_next(request)
        finally:
            _clock.unmark_lab_request(mark)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    for r in (auth.router, bank.router, device.router, admin.router, investigation.router):
        app.include_router(r, prefix="/api")
    if settings.demo_mode:  # A4: the Lab does not exist at all outside demo mode
        from app.routers import lab
        app.include_router(lab.router, prefix="/api")
    return app
