"""Heiz API entrypoint."""
from fastapi import FastAPI, Request

from app.errors import register_error_handlers
from app.routers import admin, dashboard, earthquakes, health, sources, status, synchronization
from app.web import WEB, AssetFiles, page

DESCRIPTION = (
    "Educational earthquake-information REST API (Learning Labs final project).\n\n"
    "Earthquake data is reported by **BMKG** (Badan Meteorologi, Klimatologi, dan Geofisika), "
    "https://data.bmkg.go.id/gempabumi/ . Heiz is NOT an official BMKG service, does not predict "
    "earthquakes, and is NOT an early-warning system. For official information consult BMKG."
)

app = FastAPI(title="Heiz API", version="2.0.0", description=DESCRIPTION)
register_error_handlers(app)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
    if request.url.path.startswith(("/api/admin", "/api/status")):
        response.headers["Cache-Control"] = "no-store"
    return response


for router in (health.router, status.router, earthquakes.router, sources.router,
               synchronization.router, admin.router, dashboard.api, dashboard.router):
    app.include_router(router)


@app.get("/", include_in_schema=False)
def landing():
    return page("index.html")


@app.get("/guide", include_in_schema=False)
def guide():
    return page("guide.html")


if (WEB / "assets").is_dir():
    app.mount("/assets", AssetFiles(directory=WEB / "assets"), name="assets")
