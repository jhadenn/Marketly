from collections import OrderedDict

from app.services import rate_limit


class FakePipeline:
    def __init__(self, count: int, ttl: int):
        self._count = count
        self._ttl = ttl

    def incr(self, key: str):
        return self

    def expire(self, key: str, ttl_seconds: int, nx: bool = False):
        return self

    def ttl(self, key: str):
        return self

    def execute(self):
        return [self._count, True, self._ttl]


class FakeRedis:
    def __init__(self, count: int, ttl: int):
        self._count = count
        self._ttl = ttl

    def pipeline(self):
        return FakePipeline(count=self._count, ttl=self._ttl)


def test_rate_limit_allows_under_limit(monkeypatch):
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: FakeRedis(count=3, ttl=20))

    decision = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=5,
        window_seconds=60,
    )

    assert decision.allowed is True


def test_rate_limit_blocks_over_limit(monkeypatch):
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: FakeRedis(count=6, ttl=25))

    decision = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=5,
        window_seconds=60,
    )

    assert decision.allowed is False
    assert decision.retry_after_seconds == 25


def test_rate_limit_fail_open_when_redis_errors(monkeypatch):
    class BrokenRedis:
        def pipeline(self):
            raise RuntimeError("redis down")

    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_FAIL_OPEN", True)
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_LOCAL_FALLBACK_ENABLED", False)
    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: BrokenRedis())

    decision = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=5,
        window_seconds=60,
    )

    assert decision.allowed is True


def test_rate_limit_local_fallback_blocks_over_limit_when_redis_missing(monkeypatch):
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_LOCAL_FALLBACK_ENABLED", True)
    monkeypatch.setattr(rate_limit.settings, "MARKETLY_RATE_LIMIT_LOCAL_MAX_KEYS", 100)
    monkeypatch.setattr(rate_limit, "get_redis_client", lambda: None)
    monkeypatch.setattr(rate_limit, "_local_fixed_windows", OrderedDict())
    monkeypatch.setattr(rate_limit.time, "time", lambda: 1000)

    first = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=2,
        window_seconds=60,
    )
    second = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=2,
        window_seconds=60,
    )
    third = rate_limit.check_rate_limit(
        bucket="search_ip",
        identifier="127.0.0.1",
        limit=2,
        window_seconds=60,
    )

    assert first.allowed is True
    assert second.allowed is True
    assert third.allowed is False
    assert third.retry_after_seconds == 20
