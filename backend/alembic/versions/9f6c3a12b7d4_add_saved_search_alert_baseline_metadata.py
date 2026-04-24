"""add saved search alert baseline metadata

Revision ID: 9f6c3a12b7d4
Revises: 1e4b8c7d9f2a
Create Date: 2026-04-01 16:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9f6c3a12b7d4"
down_revision: Union[str, Sequence[str], None] = "1e4b8c7d9f2a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_baseline_version", sa.Integer(), nullable=True),
    )
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_result_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_searches", "last_alert_result_count")
    op.drop_column("saved_searches", "last_alert_baseline_version")
