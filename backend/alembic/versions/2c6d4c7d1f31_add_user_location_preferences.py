"""add user location preferences

Revision ID: 2c6d4c7d1f31
Revises: c5df1a5a0d13
Create Date: 2026-03-24 18:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2c6d4c7d1f31"
down_revision: Union[str, Sequence[str], None] = "c5df1a5a0d13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_location_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column("province_code", sa.String(length=2), nullable=False),
        sa.Column("province_name", sa.String(length=80), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False, server_default="CA"),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_location_preferences_user_id",
        "user_location_preferences",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_user_location_preferences_user_id", table_name="user_location_preferences")
    op.drop_table("user_location_preferences")
