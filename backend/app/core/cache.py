import time
from collections import OrderedDict
from threading import Lock
from typing import Any


class TTLCache:
    def __init__(self, *, max_items: int | None = None):
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._max_items = None if max_items is None else max(1, int(max_items))
        self._lock = Lock()

    def _purge_expired(self, now: float) -> None:
        expired_keys = [key for key, (expires_at, _) in self._store.items() if now > expires_at]
        for key in expired_keys:
            self._store.pop(key, None)

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None

            expires_at, value = item
            if now > expires_at:
                self._store.pop(key, None)
                return None

            # Touch key to keep least-recently-used eviction behavior.
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        ttl = max(1, int(ttl_seconds))
        now = time.time()

        with self._lock:
            self._purge_expired(now)
            self._store[key] = (now + ttl, value)
            self._store.move_to_end(key)

            if self._max_items is not None:
                while len(self._store) > self._max_items:
                    self._store.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)
