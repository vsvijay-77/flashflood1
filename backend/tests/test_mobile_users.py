"""Tests for Mobile Citizen Users management, alert dispatch, and direct messaging."""
from lib.auth import create_access_token


def _get_admin_headers():
    token = create_access_token({"sub": "admin-id", "email": "admin@ein.gov.in", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


def test_list_mobile_users(client):
    headers = _get_admin_headers()
    resp = client.get("/users/mobile", headers=headers)
    assert resp.status_code == 200, resp.text
    users = resp.json()
    assert isinstance(users, list)
    # Check that users from Supabase mob_users are returned
    if users:
        first = users[0]
        assert "full_name" in first
        assert "phone_number" in first


def test_send_mobile_alert(client):
    headers = _get_admin_headers()
    payload = {
        "user_id": "test-mobile-user",
        "phone_number": "+919003899180",
        "alert_type": "FLASH_FLOOD_WARNING",
        "severity": "CRITICAL",
        "title": "Severe Flash Flood Warning",
        "message": "Water levels rising above warning threshold. Evacuate immediately.",
        "channels": ["sms", "push"],
    }
    resp = client.post("/users/mobile/send-alert", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "success"
    assert "alert_id" in data
    assert "+919003899180" in data["message"]


def test_send_mobile_message(client):
    headers = _get_admin_headers()
    payload = {
        "user_id": "test-mobile-user",
        "phone_number": "+919003899180",
        "message": "NDMA Safety Check: Are you in a safe location?",
    }
    resp = client.post("/users/mobile/send-message", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "success"
    assert "message_id" in data
