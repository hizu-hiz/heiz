from tests.conftest import KEY

VALID = {"location_description": "Test location, Bogor", "latitude": -6.69, "longitude": 106.63,
         "magnitude": 2.5, "depth_km": 9, "occurred_at": "2026-10-16T03:21:55Z"}


def create(client, **over):
    return client.post("/api/earthquakes", json={**VALID, **over}, headers=KEY)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_list_empty(client):
    r = client.get("/api/earthquakes")
    assert r.status_code == 200
    assert r.json() == {"data": [], "pagination": {"limit": 20, "offset": 0, "total": 0}}


def test_create_get_roundtrip(client):
    r = create(client)
    assert r.status_code == 201
    body = r.json()
    assert body["source_code"] == "MANUAL" and body["magnitude"] == 2.5
    assert r.headers["location"] == f"/api/earthquakes/{body['id']}"
    got = client.get(f"/api/earthquakes/{body['id']}")
    assert got.status_code == 200 and got.json()["location_description"] == VALID["location_description"]
    assert client.get("/api/earthquakes").json()["pagination"]["total"] == 1


def test_get_not_found(client):
    r = client.get("/api/earthquakes/999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_write_requires_key(client):
    assert client.post("/api/earthquakes", json=VALID).status_code == 401
    assert client.post("/api/earthquakes", json=VALID, headers={"X-API-Key": "wrong"}).status_code == 401


def test_create_rejects_invalid(client):
    for bad in ({"magnitude": 11}, {"latitude": 100}, {"depth_km": -1}, {"location_description": ""},
                {"occurred_at": "2026-10-16T03:21:55"}, {"source_id": 1}, {"latitude": None}):
        r = create(client, **bad)
        assert r.status_code == 400, bad
        assert r.json()["error"]["code"] == "validation_error"


def test_missing_required_field(client):
    r = client.post("/api/earthquakes", json={"magnitude": 3}, headers=KEY)
    assert r.status_code == 400


def test_patch(client):
    eid = create(client).json()["id"]
    r = client.patch(f"/api/earthquakes/{eid}", json={"magnitude": 3.1}, headers=KEY)
    assert r.status_code == 200 and r.json()["magnitude"] == 3.1
    assert r.json()["location_description"] == VALID["location_description"]
    assert client.patch(f"/api/earthquakes/{eid}", json={}, headers=KEY).status_code == 400
    assert client.patch(f"/api/earthquakes/{eid}", json={"location_description": None},
                        headers=KEY).status_code == 400
    assert client.patch("/api/earthquakes/999", json={"magnitude": 1}, headers=KEY).status_code == 404


def test_put_replaces_editable_fields(client):
    eid = create(client).json()["id"]
    r = client.put(f"/api/earthquakes/{eid}", json={"location_description": "New place"}, headers=KEY)
    assert r.status_code == 200
    assert r.json()["location_description"] == "New place" and r.json()["magnitude"] is None
    assert client.put(f"/api/earthquakes/{eid}", json={}, headers=KEY).status_code == 400
    assert client.put("/api/earthquakes/999", json=VALID, headers=KEY).status_code == 404


def test_delete(client):
    eid = create(client).json()["id"]
    assert client.delete(f"/api/earthquakes/{eid}", headers=KEY).status_code == 204
    assert client.get(f"/api/earthquakes/{eid}").status_code == 404
    assert client.delete(f"/api/earthquakes/{eid}", headers=KEY).status_code == 404


def test_pagination_and_filters(client):
    for m in (2.0, 4.0, 6.0):
        create(client, magnitude=m)
    r = client.get("/api/earthquakes?limit=2&min_magnitude=3")
    assert r.json()["pagination"]["total"] == 2 and len(r.json()["data"]) == 2
    assert client.get("/api/earthquakes?limit=0").status_code == 400
    assert client.get("/api/earthquakes?limit=1000").status_code == 400
    assert client.get("/api/earthquakes?source=BMKG").json()["pagination"]["total"] == 0


def test_imported_records_are_protected(client, Session):
    from datetime import datetime, timezone

    from app.models import DataSource, EarthquakeEvent
    with Session() as s:
        bmkg = s.query(DataSource).filter_by(code="BMKG").one()
        s.add(EarthquakeEvent(source_id=bmkg.id, location_description="x",
                              occurred_at=datetime.now(timezone.utc)))
        s.commit()
        eid = s.query(EarthquakeEvent).one().id
    for call in (lambda: client.patch(f"/api/earthquakes/{eid}", json={"magnitude": 1}, headers=KEY),
                 lambda: client.put(f"/api/earthquakes/{eid}", json=VALID, headers=KEY),
                 lambda: client.delete(f"/api/earthquakes/{eid}", headers=KEY)):
        r = call()
        assert r.status_code == 403 and r.json()["error"]["code"] == "imported_record_protected"


def test_unknown_route_and_method(client):
    assert client.get("/nope").status_code == 404
    assert client.post("/health").status_code == 405


def test_writes_disabled_without_key(client, monkeypatch):
    from app import config
    monkeypatch.setattr(config.get_settings(), "heiz_api_key", None)
    assert create(client).status_code == 503


def test_sources_and_synclogs(client):
    assert client.get("/api/sources").json()[0]["code"] == "BMKG"
    assert client.get("/api/sync-logs").json()["pagination"]["total"] == 0
    assert client.get("/api/sync-logs?status=bogus").status_code == 400
