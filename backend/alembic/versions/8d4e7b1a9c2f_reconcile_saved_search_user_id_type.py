"""reconcile saved_search user_id type

Revision ID: 8d4e7b1a9c2f
Revises: 5b0d7df66d4e
Create Date: 2026-03-26 01:40:00.000000
"""

from typing import Sequence, Union
import re

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "8d4e7b1a9c2f"
down_revision: Union[str, Sequence[str], None] = "5b0d7df66d4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _saved_search_user_id_type_name(bind) -> str | None:
    inspector = sa.inspect(bind)
    for column in inspector.get_columns("saved_searches"):
        if column.get("name") == "user_id":
            return str(column.get("type", "")).upper()
    return None


def _saved_search_policies(bind) -> list[dict[str, object]]:
    rows = bind.execute(
        sa.text(
            """
            SELECT policyname, permissive, roles, cmd, qual, with_check
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'saved_searches'
            ORDER BY policyname
            """
        )
    )
    return [dict(row) for row in rows.mappings().all()]


def _quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _quote_role(role: str) -> str:
    normalized = str(role)
    if normalized.lower() == "public":
        return "PUBLIC"
    return _quote_identifier(normalized)


def _normalize_policy_expression(expression: str | None) -> str | None:
    if expression is None:
        return None
    return re.sub(r"auth\.uid\(\)(?!\s*::)", "(auth.uid())::text", expression)


def _render_create_policy_sql(policy: dict[str, object]) -> str:
    policy_name = _quote_identifier(str(policy["policyname"]))
    permissive = str(policy.get("permissive") or "PERMISSIVE").upper()
    command = str(policy.get("cmd") or "ALL").upper()
    roles = policy.get("roles") or []
    if isinstance(roles, str):
        roles = [roles]
    roles_sql = ""
    if roles:
        roles_sql = " TO " + ", ".join(_quote_role(str(role)) for role in roles)

    sql = (
        f"CREATE POLICY {policy_name} ON {_quote_identifier('saved_searches')} "
        f"AS {permissive} FOR {command}{roles_sql}"
    )
    qual = _normalize_policy_expression(policy.get("qual"))
    with_check = _normalize_policy_expression(policy.get("with_check"))
    if qual is not None:
        sql += f" USING {qual}"
    if with_check is not None:
        sql += f" WITH CHECK {with_check}"
    return sql


def upgrade() -> None:
    bind = op.get_bind()
    type_name = _saved_search_user_id_type_name(bind)
    if not type_name or "UUID" not in type_name:
        return

    policies = _saved_search_policies(bind)
    for policy in policies:
        policy_name = _quote_identifier(str(policy["policyname"]))
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {_quote_identifier('saved_searches')}")

    op.alter_column(
        "saved_searches",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        type_=sa.String(),
        existing_nullable=True,
        postgresql_using="user_id::text",
    )
    for policy in policies:
        op.execute(_render_create_policy_sql(policy))


def downgrade() -> None:
    # Irreversible: once opaque string user ids are stored, not all values are valid UUIDs.
    pass
