import os


os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")


import pytest


@pytest.fixture(autouse=True)
def _reset_local_rate_limit_state():
    from app.services import rate_limit as _rate_limit_module

    with _rate_limit_module._local_lock:
        _rate_limit_module._local_fixed_windows.clear()
    yield
    with _rate_limit_module._local_lock:
        _rate_limit_module._local_fixed_windows.clear()
