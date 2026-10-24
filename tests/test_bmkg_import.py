import pytest

from app.config import get_settings
from app.models import EarthquakeEvent, EventUpdate, SyncLog
from app.services import bmkg
from tests.conftest import KEY

# Shapes copied from real BMKG responses.
M5 = {"Tanggal": "12 Okt 2026", "Jam": "04:34:53 WIB", "DateTime": "2026-10-11T21:34:53+00:00",
      "Coordinates": "0.64,121.75", "Lintang": "0.64 LU", "Bujur": "121.75 BT", "Magnitude": "5.7",
      "Kedalaman": "76 km", "Wilayah": "29 km BaratLaut POHUWATO-GORONTALO",
      "Potensi": "Tidak berpotensi tsunami"}
FELT = {"Tanggal": "16 Okt 2026", "Jam": "10:21:55 WIB", "DateTime": "2026-10-16T03:21:55+00:00",
        "Coordinates": "-6.69,106.63", "Lintang": "6.69 LS", "Bujur": "106.63 BT",
        "Magnitude": "2.5", "Kedalaman": "9 km",
        "Wilayah": "Pusat gempa berada di darat 21 km Barat Daya Kota Bogor",
        "Dirasakan": "II Kabandungan"}


def sync(Session, payload, feed="gempaterkini"):
    with Session() as db:
        from app.models import DataSource
        src = db.query(DataSource).filter_by(code="BMKG").one()
        fetcher = payload if callable(payload) else (lambda url, s: payload)
        return bmkg.run_feed_sync(db, src, feed, get_settings(), fetcher=fetcher)


def test_normalize_real_record():
    ev = bmkg.normalize_record(M5)
    assert float(ev.latitude) == 0.64 and float(ev.longitude) == 121.75
    assert float(ev.magnitude) == 5.7 and float(ev.depth_km) == 76 # type: ignore
    assert ev.tsunami_potential is False and ev.occurred_at.utcoffset().total_seconds() == 0 # type: ignore
    assert ev.key == "derived:2026-10-11T21:34:53Z|0.64,121.75"


def test_felt_record_has_null_tsunami():
    assert bmkg.normalize_record(FELT).tsunami_potential is None


@pytest.mark.parametrize("patch", [{"DateTime": "garbage"}, {"Coordinates": "1"},
                                   {"Coordinates": "95,10"}, {"Wilayah": " "},
                                   {"Magnitude": "abc"}, {"Magnitude": "11"}, {"Kedalaman": "deep"}])
def test_invalid_records_rejected(patch):
    with pytest.raises(bmkg.RecordError):
        bmkg.normalize_record({**M5, **patch})


def test_missing_optional_values_stay_null():
    item = {k: v for k, v in M5.items() if k not in ("Magnitude", "Kedalaman", "Potensi")}
    ev = bmkg.normalize_record(item)
    assert ev.magnitude is None and ev.depth_km is None and ev.tsunami_potential is None


def test_extract_shapes():
    assert bmkg.extract_records([M5]) == [M5]
    assert bmkg.extract_records({"Infogempa": {"gempa": M5}}) == [M5]
    assert bmkg.extract_records({"Infogempa": {"gempa": [M5, FELT]}}) == [M5, FELT]
    for bad in ({}, "x", None, {"Infogempa": {}}):
        with pytest.raises(bmkg.FeedError):
            bmkg.extract_records(bad)


def test_sync_creates_then_dedupes(Session):
    log = sync(Session, [M5, FELT])
    assert (log.status, log.records_received, log.records_created, log.records_skipped) == ("success", 2, 2, 0)
    log2 = sync(Session, [M5, FELT])
    assert (log2.status, log2.records_created, log2.records_updated, log2.records_skipped) == ("success", 0, 0, 2)
    with Session() as db:
        assert db.query(EarthquakeEvent).count() == 2
        assert db.query(EventUpdate).filter_by(change_type="created").count() == 2


def test_duplicates_within_one_payload(Session):
    log = sync(Session, [M5, M5])
    assert log.records_created == 1 and log.records_skipped == 1


def test_update_tracked_and_no_null_overwrite(Session):
    sync(Session, [M5])
    revised = {**M5, "Magnitude": "5.9"}
    log = sync(Session, [revised])
    assert log.records_updated == 1
    # same quake in the felt feed style: no Potensi -> must not erase tsunami_potential
    sync(Session, [{k: v for k, v in revised.items() if k != "Potensi"}], feed="gempadirasakan")
    with Session() as db:
        ev = db.query(EarthquakeEvent).one()
        assert float(ev.magnitude) == 5.9 and ev.tsunami_potential is False
        up = db.query(EventUpdate).filter_by(change_type="corrected").one()
        assert up.changed_fields["magnitude"]["new"] == "5.90"
        assert set(ev.raw_payload) == {"gempaterkini", "gempadirasakan"}
        assert ev.source_attribution == "BMKG"


def test_partial_when_some_records_invalid(Session):
    log = sync(Session, [M5, {**FELT, "Wilayah": ""}])
    assert log.status == "partial" and log.records_created == 1 and log.records_skipped == 1
    assert "invalid" in log.error_summary # type: ignore


def test_all_invalid_is_failed(Session):
    assert sync(Session, [{"DateTime": "x"}]).status == "failed"


def test_empty_feed_is_success(Session):
    log = sync(Session, [])
    assert log.status == "success" and log.records_received == 0


@pytest.mark.parametrize("exc,expected", [
    (bmkg.FeedError("BMKG request timed out"), "timed out"),
    (bmkg.FeedError("BMKG responded with HTTP 503"), "503"),
    (bmkg.FeedError("BMKG response was not valid JSON"), "JSON"),
])
def test_fetch_failures_are_logged_as_failed(Session, exc, expected):
    def boom(url, settings):
        raise exc
    log = sync(Session, boom)
    assert log.status == "failed" and expected in log.error_summary and log.finished_at


def test_unexpected_exception_is_sanitized(Session):
    def boom(url, settings):
        raise RuntimeError("postgresql://user:SECRET@host/db")
    log = sync(Session, boom)
    assert log.status == "failed" and "SECRET" not in log.error_summary # type: ignore


def test_fetch_feed_http_handling(monkeypatch):
    import httpx
    s = get_settings()

    def fake(status=200, body=b"[]", exc=None):
        def _get(*a, **k):
            if exc:
                raise exc
            return httpx.Response(status, content=body)
        return _get
    monkeypatch.setattr(bmkg.httpx, "get", fake(exc=httpx.ReadTimeout("t")))
    with pytest.raises(bmkg.FeedError, match="timed out"):
        bmkg.fetch_feed("https://x", s)
    monkeypatch.setattr(bmkg.httpx, "get", fake(status=503))
    with pytest.raises(bmkg.FeedError, match="503"):
        bmkg.fetch_feed("https://x", s)
    monkeypatch.setattr(bmkg.httpx, "get", fake(body=b"<xml>"))
    with pytest.raises(bmkg.FeedError, match="JSON"):
        bmkg.fetch_feed("https://x", s)
    monkeypatch.setattr(bmkg.httpx, "get", fake(body=b"[1]"))
    assert bmkg.fetch_feed("https://x", s) == [1]


# /api/sync endpoint: protection, validation, throttling
def test_sync_endpoint_protection_and_validation(client):
    assert client.post("/api/sync").status_code == 401
    assert client.post("/api/sync", json={"feeds": ["nope"]}, headers=KEY).status_code == 400


def test_sync_endpoint_runs_and_throttles(client, monkeypatch):
    original = bmkg.run_feed_sync

    def patched(db, source, feed, settings, fetcher=None):
        return original(db, source, feed, settings, fetcher=lambda u, s: [M5]) # type: ignore
    monkeypatch.setattr("app.routers.synchronization.bmkg.run_feed_sync", patched)
    r = client.post("/api/sync", json={"feeds": ["gempaterkini"]}, headers=KEY)
    assert r.status_code == 200 and r.json()[0]["status"] == "success"
    assert r.json()[0]["request_url"].endswith("/gempaterkini.json")
    r2 = client.post("/api/sync", headers=KEY)
    assert r2.status_code == 429 and "retry-after" in r2.headers
    assert client.get("/api/sync-logs").json()["pagination"]["total"] == 1
