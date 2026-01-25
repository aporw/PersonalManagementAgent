import json
import time
from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_create_and_login_returns_token_and_user():
    # create a new user
    payload = {"name": "Test User", "email": f"test+{int(time.time())}@example.com", "password": "pass123"}
    r = client.post("/users/create", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert "user" in data
    assert "token" in data

    # login with same credentials
    r2 = client.post("/users/login", json={"email": payload["email"], "password": payload["password"]})
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("ok") is True
    assert "token" in d2


def test_credits_endpoint_requires_token_and_awards():
    # create user
    payload = {"name": "Credits User", "email": f"credits+{int(time.time())}@example.com", "password": "secret"}
    r = client.post("/users/create", json=payload)
    assert r.status_code == 200
    d = r.json()
    uid = d["user"]["user_id"]
    token = d["token"]

    # calling without token should fail
    r_no = client.post(f"/users/{uid}/credits", json={"amount": 2})
    assert r_no.status_code in (401, 422)

    # calling with token for different user should fail
    # fake token by creating another user
    payload2 = {"name": "Other", "email": f"other+{int(time.time())}@example.com", "password": "pw"}
    r3 = client.post("/users/create", json=payload2)
    t2 = r3.json()["token"]
    h = {"Authorization": f"Bearer {t2}"}
    r_bad = client.post(f"/users/{uid}/credits", headers=h, json={"amount": 2})
    assert r_bad.status_code == 403

    # call with proper token should succeed
    h_ok = {"Authorization": f"Bearer {token}"}
    r_ok = client.post(f"/users/{uid}/credits", headers=h_ok, json={"amount": 4})
    assert r_ok.status_code == 200
    body = r_ok.json()
    assert body.get("ok") is True
    assert body.get("messages_left") == 4


def test_message_post_decrements_messages_left():
    payload = {"name": "MsgUser", "email": f"msg+{int(time.time())}@example.com", "password": "pw123"}
    r = client.post("/users/create", json=payload)
    assert r.status_code == 200
    d = r.json()
    uid = d["user"]["user_id"]
    token = d["token"]

    # award 2 credits
    h = {"Authorization": f"Bearer {token}"}
    r_award = client.post(f"/users/{uid}/credits", headers=h, json={"amount": 2})
    assert r_award.status_code == 200
    assert r_award.json().get("messages_left") == 2

    # send a message (should decrement)
    msg = {"user_id": uid, "thread_id": "t_test", "role": "user", "content": "hello"}
    r_msg = client.post("/message", json=msg, headers=h)
    assert r_msg.status_code == 200

    # check user now has 1 left
    r_user = client.get(f"/users/{uid}")
    assert r_user.status_code == 200
    assert r_user.json()["user"].get("messages_left") == 1
