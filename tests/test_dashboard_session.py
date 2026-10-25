import time

from app import config, security
from tests.conftest import ADMIN, KEY

WRONG = {"Authorization": "Bearer " + "x" * 30}     # built from parts: obviously not a real credential

SHELL = lambda: f"/dashboard/dashboard-{security.dashboard_id()}.html"  # noqa: E731


def login(client, headers=ADMIN):
    return client.post("/api/admin/session", headers=headers)


def test_shell_is_hidden_without_a_session(client):
    assert client.get(SHELL()).status_code == 404
    assert client.get("/dashboard/dashboard-000000000000.html").status_code == 404
    assert client.get("/dashboard/shell.html").status_code == 404
    assert client.get("/dashboard/login.html").status_code == 404     # files are not browsable, only the routes


def test_login_sets_a_locked_down_cookie_and_unlocks_the_shell(client):
    r = login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["dashboard_url"] == SHELL() and body["expires_in"] == 8 * 3600
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/dashboard" in cookie
    assert r.headers["cache-control"] == "no-store"
    page = client.get(body["dashboard_url"])
    assert page.status_code == 200 and "Control room" in page.text
    assert page.headers["x-robots-tag"] == "noindex, nofollow" and page.headers["cache-control"] == "no-store"


def test_wrong_or_writer_token_does_not_log_in(client):
    assert login(client, WRONG).status_code == 401
    assert login(client, KEY).status_code == 401           # the writer key is not an admin credential
    assert login(client, {}).status_code == 401
    assert client.get(SHELL()).status_code == 404


def test_cookie_is_not_api_authorisation(client):
    login(client)
    assert client.get("/api/admin/whoami").status_code == 401        # cookie alone never opens the API
    assert client.post("/api/sync").status_code == 401


def test_tampered_or_expired_cookies_are_rejected(client):
    value, _ = security.issue_session()
    assert security.session_valid(value)
    exp = value.split(".")[1]
    assert not security.session_valid(value.replace(exp, str(int(exp) + 1000)))      # changed expiry
    assert not security.session_valid(value[:-2] + "00")                              # changed signature
    assert not security.session_valid("v1.9999999999.abc") and not security.session_valid("")
    assert not security.session_valid(value, now=time.time() + 8 * 3600 + 5)          # expired
    client.cookies.set("heiz_dash", value + "x", path="/dashboard")
    assert client.get(SHELL()).status_code == 404


def test_logout_clears_the_cookie(client):
    login(client)
    r = client.delete("/api/admin/session")
    assert r.status_code == 204 and "max-age=0" in r.headers["set-cookie"].lower()
    assert client.get(SHELL()).status_code == 404


def test_login_is_throttled_after_repeated_failures(client):
    security._failures.clear()
    bad = WRONG
    for _ in range(security.LOGIN_MAX_FAILURES):
        assert login(client, bad).status_code == 401
    r = login(client, bad)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert login(client).status_code == 429                  # even the right token waits (brake is per client)
    security._failures.clear()
    assert login(client).status_code == 200


def test_rotating_the_admin_token_invalidates_sessions_and_the_page_id(client, monkeypatch):
    from pydantic import SecretStr
    login(client)
    old_id = security.dashboard_id()
    monkeypatch.setattr(config.get_settings(), "heiz_admin_token", SecretStr("a-different-admin-token-0123456789"))
    assert security.dashboard_id() != old_id
    assert client.get(f"/dashboard/dashboard-{old_id}.html").status_code == 404


def test_dashboard_disabled_without_admin_token(client, monkeypatch):
    monkeypatch.setattr(config.get_settings(), "heiz_admin_token", None)
    assert security.dashboard_id() is None
    assert client.post("/api/admin/session", headers=ADMIN).status_code == 503
    assert client.get("/dashboard/dashboard-None.html").status_code == 404
