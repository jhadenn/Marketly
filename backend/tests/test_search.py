from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_search():
    r = client.get("/search", params={"q": "iphone", "sources": "ebay,kijiji"})
    assert r.status_code == 200
    data = r.json()
    assert data["query"] == "iphone"
    assert data["count"] >= 1
    assert any(x["source"] == "ebay" for x in data["results"])
    assert any(x["source"] == "kijiji" for x in data["results"])
