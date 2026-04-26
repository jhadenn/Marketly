"""add alert source error metadata

Revision ID: a7c9f2d4e6b1
Revises: 9f6c3a12b7d4
Create Date: 2026-04-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7c9f2d4e6b1"
down_revision: Union[str, Sequence[str], None] = "9f6c3a12b7d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_source_errors_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "saved_search_notifications",
        sa.Column("source_errors_json", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_search_notifications", "source_errors_json")
    op.drop_column("saved_searches", "last_alert_source_errors_json")
