from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.external_sensors import router
from services import external_sensor_service as sensors


def test_sensor_outage_returns_unavailable_instead_of_fabricated_readings(monkeypatch):
    def offline():
        raise ConnectionError("offline")
    monkeypatch.setattr(sensors, "get_connection", offline)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    with TestClient(app) as client:
        for path in ("history?limit=30", "packets?limit=100"):
            response = client.get("/api/external-sensors/" + path)
            assert response.status_code == 503
            assert "SENSOR_DB_URL" in response.json()["detail"]
        assert client.get("/api/external-sensors/summary").json()["connected"] is False
        assert client.get("/api/external-sensors/latest").json()["has_data"] is False
