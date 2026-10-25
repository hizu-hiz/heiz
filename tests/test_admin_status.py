from datetime import datetime, timedelta, timezone

from pydantic import SecretStr
from sqlalchemy.exc import OperationalError

from app import config
from app.models import EarthquakeEvent, EventUpdate, SyncLog
from tests.conftest import ADMIN, KEY

VALID = {"location_description": "Manual place", "magnitude": 3.0}


# ---- auth tiers
def test_admin_endpoints_need_bearer(client):
    assert client.get("/api/admin/whoami").status_code == 401
    assert client.get("/api/admin/whoami", headers=KEY).status_code == 401   # writer key rejected
    assert client.get("/api/admin/whoami", headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.get("/api/admin/whoami", headers=ADMIN)
    assert r.status_code == 200 and r.json() == {"role": "admin"}
    assert client.get("/api/admin/whoami").headers["www-authenticate"] == "Bearer"


def test_whoami_works_without_database(client):
    # whoami must not need the DB so the dashboard login works during outages
    from app.database import get_db
    from app.main import app

    def broken():
        raise OperationalError("x", {}, Exception("down"))
        yield
    app.dependency_overrides[get_db] = broken
    assert client.get("/api/admin/whoami", headers=ADMIN).status_code == 200


def test_admin_token_can_also_write(client):
    assert client.post("/api/earthquakes", json=VALID, headers=ADMIN).status_code == 201


def test_short_secrets_are_rejected(client, monkeypatch):
    s = config.get_settings()
    monkeypatch.setattr(s, "heiz_admin_token", SecretStr("short"))
    monkeypatch.setattr(s, "heiz_api_key", SecretStr("short"))
    assert client.get("/api/admin/whoami", headers={"Authorization": "Bearer short"}).status_code == 503
    assert client.post("/api/earthquakes", json=VALID, headers={"X-API-Key": "short"}).status_code == 503


# ---- DB down => structured, retryable 503
def test_database_down_is_retryable_503(client):
    from app.database import get_db
    from app.main import app

    def broken():
        raise OperationalError("SELECT 1", {}, Exception("password=SECRET host=db"))
        yield
    app.dependency_overrides[get_db] = broken
    r = client.get("/api/earthquakes")
    assert r.status_code == 503 and r.headers["retry-after"] == "30"
    err = r.json()["error"]
    assert err["code"] == "database_unavailable" and err["retryable"] is True
    assert "SECRET" not in r.text


def test_status_ok_and_down(client, engine, monkeypatch):
    from app.routers import status as status_router
    monkeypatch.setattr(status_router, "get_engine", lambda: engine)
    r = client.get("/api/status")
    assert r.status_code == 200 and r.json()["database"] == "ok" and r.headers["cache-control"] == "no-store"

    class Dead:
        def connect(self):
            raise OperationalError("x", {}, Exception("down"))
    monkeypatch.setattr(status_router, "get_engine", lambda: Dead())
    r = client.get("/api/status")
    assert r.status_code == 200 and r.json()["database"] == "unavailable"
    assert r.json()["retry_after_seconds"] == 30


def test_status_not_configured(client):
    r = client.get("/api/status")        # no DATABASE_URL in tests
    assert r.status_code == 200 and r.json()["database"] == "not_configured"


# ---- overview + prune
def seed(Session):
    old = datetime.now(timezone.utc) - timedelta(days=400)
    with Session() as db:
        from app.models import DataSource
        bmkg = db.query(DataSource).filter_by(code="BMKG").one()
        db.add(SyncLog(source_id=bmkg.id, status="success", started_at=old, finished_at=old))
        db.add(SyncLog(source_id=bmkg.id, status="running",
                       started_at=datetime.now(timezone.utc) - timedelta(minutes=60)))
        db.add(EarthquakeEvent(source_id=bmkg.id, location_description="old imported",
                               occurred_at=old, imported_at=old, raw_payload={"a": 1}))
        db.add(EarthquakeEvent(source_id=bmkg.id, location_description="fresh imported",
                               occurred_at=datetime.now(timezone.utc), raw_payload={"a": 1}))
        db.commit()
        e = db.query(EarthquakeEvent).filter_by(location_description="old imported").one()
        db.add(EventUpdate(event_id=e.id, change_type="updated", changed_at=old))
        db.commit()


def test_overview(client, Session):
    seed(Session)
    r = client.get("/api/admin/overview", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["earthquake_events"] == 2 and body["counts"]["sync_logs"] == 2
    assert body["storage"]["supported"] is False        # SQLite in tests; PostgreSQL reports sizes
    assert client.get("/api/admin/overview", headers=KEY).status_code == 401


def test_prune_is_dry_run_by_default(client, Session):
    seed(Session)
    r = client.post("/api/admin/maintenance/prune", headers=ADMIN)
    body = r.json()
    assert r.status_code == 200 and body["dry_run"] is True
    assert {s["rule"]: s["matched"] for s in body["steps"]} == {
        "stale_running_sync_logs": 1, "null_old_raw_payload": 1, "delete_old_event_updates": 1,
        "delete_old_sync_logs": 1, "delete_old_imported_events": 1}
    assert all(s["changed"] == 0 for s in body["steps"])
    with Session() as db:
        assert db.query(EarthquakeEvent).count() == 2          # nothing deleted


def test_prune_executes_and_protects_manual_and_fresh_rows(client, Session):
    seed(Session)
    client.post("/api/earthquakes", json=VALID, headers=ADMIN)   # MANUAL event
    with Session() as db:   # make the manual event ancient: it must still survive
        m = db.query(EarthquakeEvent).filter_by(location_description="Manual place").one()
        m.occurred_at = datetime.now(timezone.utc) - timedelta(days=900)
        db.commit()
    r = client.post("/api/admin/maintenance/prune", json={"dry_run": False}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["dry_run"] is False
    with Session() as db:
        names = {e.location_description for e in db.query(EarthquakeEvent).all()}
        assert names == {"fresh imported", "Manual place"}
        fresh = db.query(EarthquakeEvent).filter_by(location_description="fresh imported").one()
        assert fresh.raw_payload == {"a": 1}                    # recent payload kept
        stale = db.query(SyncLog).filter(SyncLog.error_summary.like("marked failed%")).one()
        assert stale.status == "failed" and stale.finished_at is not None
        assert db.query(SyncLog).filter_by(status="success").count() == 0   # old log deleted
    again = client.post("/api/admin/maintenance/prune", json={"dry_run": False}, headers=ADMIN).json()
    assert all(s["matched"] == 0 for s in again["steps"] if s["rule"] != "null_old_raw_payload")


def test_prune_respects_batch_cap_and_disabled_rules(client, Session, monkeypatch):
    seed(Session)
    s = config.get_settings()
    monkeypatch.setattr(s, "retention_events_days", 0)
    monkeypatch.setattr(s, "prune_batch_size", 1)
    body = client.post("/api/admin/maintenance/prune", json={"dry_run": False}, headers=ADMIN).json()
    rules = {x["rule"]: x for x in body["steps"]}
    assert rules["delete_old_imported_events"]["enabled"] is False
    with Session() as db:
        assert db.query(EarthquakeEvent).count() == 2


# ---- web pages & headers
def test_security_headers_and_pages(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "geolocation=()" in r.headers["permissions-policy"]
    for path in ("/", "/guide", "/dashboard/"):
        r = client.get(path)
        assert r.status_code == 200 and "script-src 'self'" in r.headers["content-security-policy"]
        assert "form-action 'none'" in r.headers["content-security-policy"]
        assert r.headers["x-frame-options"] == "DENY"
    assert client.get("/dashboard/").headers["x-robots-tag"] == "noindex, nofollow"
    assert client.get("/dashboard", follow_redirects=False).status_code == 308
    assert client.get("/assets/js/core/dom.js").status_code == 200


def test_new_fields_in_api_output(client, Session):
    from app.models import DataSource
    with Session() as db:
        b = db.query(DataSource).filter_by(code="BMKG").one()
        db.add(EarthquakeEvent(source_id=b.id, location_description="x", tsunami_note="Tidak berpotensi tsunami",
                               tsunami_potential=False, felt_text="II Kabandungan",
                               shakemap_code="20261016102155.mmi.jpg"))
        db.commit()
    d = client.get("/api/earthquakes").json()["data"][0]
    assert d["felt_text"] == "II Kabandungan" and d["tsunami_note"] == "Tidak berpotensi tsunami"
    assert d["shakemap_url"] == "https://static.bmkg.go.id/20261016102155.mmi.jpg"


# ---- test hygiene: a developer's .env must never leak into the test run
def test_settings_ignore_dotenv_during_tests(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("DATABASE_URL=postgresql://user:pw@db.invalid:5432/x\n")
    monkeypatch.chdir(tmp_path)
    config.get_settings.cache_clear()
    assert config.get_settings().database_url is None
