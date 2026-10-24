import os

os.environ["HEIZ_API_KEY"] = "test-key"          # test-only value, not a real secret
os.environ.pop("DATABASE_URL", None)

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
KEY = {"X-API-Key": "test-key"}


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
def client(Session):
    def _db():
        with Session() as s:
            yield s
    app.dependency_overrides[get_db] = _db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()
