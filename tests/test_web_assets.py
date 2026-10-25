"""Static assets must be served with the right Content-Type whatever the host OS registry says
(a Windows registry mapping .js to text/plain made scripts refuse to run under nosniff)."""
import mimetypes
import re
from pathlib import Path

import pytest

from app.web import CONTENT_TYPES, WEB

JS = "text/javascript"


def test_js_is_javascript_even_if_the_host_registry_is_wrong(client, monkeypatch):
    mimetypes.init()
    monkeypatch.setitem(mimetypes.types_map, ".js", "text/plain")        # simulate the broken Windows registry
    monkeypatch.setitem(mimetypes.types_map, ".css", "text/plain")
    assert mimetypes.guess_type("x.js")[0] == "text/plain"
    r = client.get("/assets/js/pages/landing.js")
    assert r.status_code == 200 and r.headers["content-type"].startswith(JS)
    assert client.get("/assets/css/tokens.css").headers["content-type"].startswith("text/css")
    assert client.get("/assets/img/heiz-logo-accent.svg").headers["content-type"].startswith("image/svg+xml")
    assert client.get("/assets/vendor/leaflet/leaflet.js").headers["content-type"].startswith(JS)


def test_every_shipped_asset_type_is_mapped():
    suffixes = {p.suffix.lower() for p in (WEB / "assets").rglob("*") if p.is_file()}
    assert suffixes - set(CONTENT_TYPES) == set()


PAGES = ["index.html", "guide.html", "dashboard/login.html", "dashboard/shell.html"]


@pytest.mark.parametrize("page", PAGES)
def test_pages_only_reference_files_that_exist_and_have_no_inline_script(page):
    html = (WEB / page).read_text()
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html), "inline <script> would be blocked by the CSP"
    assert not re.search(r"\son[a-z]+\s*=", html), "inline event handlers would be blocked by the CSP"
    for ref in re.findall(r'(?:src|href)="(/assets/[^"]+)"', html):
        assert (WEB / ref.lstrip("/")).is_file(), f"{page} references missing {ref}"


def test_js_modules_import_only_existing_files():
    root = WEB / "assets" / "js"
    for f in root.rglob("*.js"):
        content = f.read_text(encoding="utf-8")
        for spec in re.findall(r"(?:from|import)\s*\(?\s*'(\.[^']+)'", content):
            assert (f.parent / spec).resolve().is_file(), f"{f.relative_to(WEB)} imports missing {spec}"


def test_login_form_cannot_leak_the_token():
    html = (WEB / "dashboard/login.html").read_text()
    assert 'method="post"' in html and 'name="token"' not in html     # nothing is submitted natively, never a URL
    assert "?token=" not in html
