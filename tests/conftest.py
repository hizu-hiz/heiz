import os

# Tests must be hermetic: ignore any developer .env / real environment (a real DATABASE_URL in .env made
# test_status_not_configured connect to the live database). Settings are re-read from this environment only.
from app.config import Settings  # noqa: E402

Settings.model_config["env_file"] = None
for _name in Settings.model_fields:
    os.environ.pop(_name.upper(), None)

os.environ["HEIZ_API_KEY"] = "test-writer-key-0123456789abcdef"      # test-only values, not secrets
os.environ["HEIZ_ADMIN_TOKEN"] = "test-admin-token-0123456789abcdef"

import warnings  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, DataSource  # noqa: E402

warnings.filterwarnings("ignore", message=".*does \\*not\\* support Decimal.*")
KEY = {"X-API-Key": "test-writer-key-0123456789abcdef"}
ADMIN = {"Authorization": "Bearer test-admin-token-0123456789abcdef"}


@pytest.fixture(autouse=True)
def _never_a_real_database():
    from app.config import get_settings
    get_settings.cache_clear()
    assert get_settings().database_url is None, "tests must never see a real DATABASE_URL"
    yield
    get_settings.cache_clear()


@pytest.fixture()
def Session():
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as s:
        s.add(DataSource(code="BMKG", name="BMKG", base_url="https://data.bmkg.go.id/gempabumi/"))
        s.commit()
    return factory


@pytest.fixture()
def engine(Session):
    return Session.kw["bind"]


@pytest.fixture()
def client(Session):
    def _db():
        with Session() as s:
            yield s
    app.dependency_overrides[get_db] = _db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()
