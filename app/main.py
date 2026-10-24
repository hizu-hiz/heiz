"""Heiz API entrypoint."""
from fastapi import FastAPI

from app.errors import register_error_handlers
from app.routers import earthquakes, health, sources, synchronization

DESCRIPTION = (
    "Educational earthquake-information REST API (Learning Labs final project).\n\n"
    "Earthquake data is reported by **BMKG** (Badan Meteorologi, Klimatologi, dan Geofisika), "
    "https://data.bmkg.go.id/gempabumi/ . Heiz is NOT an official BMKG service, does not predict "
    "earthquakes, and is NOT an early-warning system. For official information consult BMKG."
)

app = FastAPI(title="Heiz API", version="0.1.0", description=DESCRIPTION)
register_error_handlers(app)
app.include_router(health.router)
app.include_router(earthquakes.router)
app.include_router(sources.router)
app.include_router(synchronization.router)


@app.get("/", include_in_schema=False)
def root():
    return {"name": "Heiz API", "docs": "/docs", "health": "/health",
            "data_credit": "BMKG (https://data.bmkg.go.id/gempabumi/)",
            "disclaimer": "Educational project; not an official or early-warning service."}
