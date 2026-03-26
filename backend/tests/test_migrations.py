import importlib.util
from pathlib import Path
from types import SimpleNamespace


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "8d4e7b1a9c2f_reconcile_saved_search_user_id_type.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location(
        "reconcile_saved_search_user_id_type",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_saved_search_user_id_migration_alters_uuid_columns(monkeypatch):
    module = _load_migration_module()
    alter_calls: list[tuple[tuple, dict]] = []
    sql_calls: list[str] = []

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def mappings(self):
            return self

        def all(self):
            return self._rows

    class FakeBind:
        def execute(self, statement):
            statement_text = str(statement)
            assert "FROM pg_policies" in statement_text
            return FakeResult(
                [
                    {
                        "policyname": "saved_searches_select_own",
                        "permissive": "PERMISSIVE",
                        "roles": ["authenticated"],
                        "cmd": "SELECT",
                        "qual": "(auth.uid() = user_id)",
                        "with_check": None,
                    }
                ]
            )

    fake_bind = FakeBind()

    class FakeInspector:
        def get_columns(self, table_name: str):
            assert table_name == "saved_searches"
            return [{"name": "user_id", "type": "UUID"}]

    monkeypatch.setattr(
        module,
        "op",
        SimpleNamespace(
            get_bind=lambda: fake_bind,
            alter_column=lambda *args, **kwargs: alter_calls.append((args, kwargs)),
            execute=lambda sql: sql_calls.append(sql),
        ),
    )
    monkeypatch.setattr(module.sa, "inspect", lambda bind: FakeInspector())

    module.upgrade()

    assert len(alter_calls) == 1
    args, kwargs = alter_calls[0]
    assert args == ("saved_searches", "user_id")
    assert kwargs["postgresql_using"] == "user_id::text"
    assert kwargs["existing_nullable"] is True
    assert isinstance(kwargs["type_"], module.sa.String)
    assert sql_calls[0] == 'DROP POLICY IF EXISTS "saved_searches_select_own" ON "saved_searches"'
    assert (
        sql_calls[1]
        == 'CREATE POLICY "saved_searches_select_own" ON "saved_searches" AS PERMISSIVE '
        'FOR SELECT TO "authenticated" USING ((auth.uid())::text = user_id)'
    )


def test_saved_search_user_id_migration_skips_character_columns(monkeypatch):
    module = _load_migration_module()
    alter_calls: list[tuple[tuple, dict]] = []
    sql_calls: list[str] = []
    fake_bind = object()

    class FakeInspector:
        def get_columns(self, table_name: str):
            assert table_name == "saved_searches"
            return [{"name": "user_id", "type": "VARCHAR(255)"}]

    monkeypatch.setattr(
        module,
        "op",
        SimpleNamespace(
            get_bind=lambda: fake_bind,
            alter_column=lambda *args, **kwargs: alter_calls.append((args, kwargs)),
            execute=lambda sql: sql_calls.append(sql),
        ),
    )
    monkeypatch.setattr(module.sa, "inspect", lambda bind: FakeInspector())

    module.upgrade()

    assert alter_calls == []
    assert sql_calls == []
