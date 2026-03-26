"""add saved search alert attempt fields

Revision ID: 5b0d7df66d4e
Revises: 2c6d4c7d1f31
Create Date: 2026-03-25 23:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5b0d7df66d4e"
down_revision: Union[str, Sequence[str], None] = "2c6d4c7d1f31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_error_code", sa.String(), nullable=True),
    )
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_error_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_searches", "last_alert_error_message")
    op.drop_column("saved_searches", "last_alert_error_code")
    op.drop_column("saved_searches", "last_alert_attempted_at")
