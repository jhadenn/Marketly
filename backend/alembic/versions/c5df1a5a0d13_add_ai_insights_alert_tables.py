"""add ai insights and alert tables

Revision ID: c5df1a5a0d13
Revises: f0b7e9d32c17
Create Date: 2026-03-17 15:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c5df1a5a0d13"
down_revision: Union[str, Sequence[str], None] = "f0b7e9d32c17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_searches",
        sa.Column("alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "saved_searches",
        sa.Column("last_alert_notified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "listing_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("saved_search_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("source_listing_id", sa.String(), nullable=False),
        sa.Column("listing_fingerprint", sa.String(length=128), nullable=False),
        sa.Column("query", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("price_amount", sa.Float(), nullable=True),
        sa.Column("price_currency", sa.String(length=3), nullable=True),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("condition", sa.String(), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("valuation_key", sa.String(length=255), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_listing_snapshots_user_id", "listing_snapshots", ["user_id"], unique=False)
    op.create_index(
        "ix_listing_snapshots_saved_search_id",
        "listing_snapshots",
        ["saved_search_id"],
        unique=False,
    )
    op.create_index("ix_listing_snapshots_source", "listing_snapshots", ["source"], unique=False)
    op.create_index(
        "ix_listing_snapshots_listing_fingerprint",
        "listing_snapshots",
        ["listing_fingerprint"],
        unique=False,
    )
    op.create_index("ix_listing_snapshots_query", "listing_snapshots", ["query"], unique=False)
    op.create_index(
        "ix_listing_snapshots_valuation_key",
        "listing_snapshots",
        ["valuation_key"],
        unique=False,
    )
    op.create_index(
        "ix_listing_snapshots_observed_at",
        "listing_snapshots",
        ["observed_at"],
        unique=False,
    )
    op.create_index(
        "ix_listing_snapshots_saved_search_listing_observed",
        "listing_snapshots",
        ["saved_search_id", "listing_fingerprint", "observed_at"],
        unique=False,
    )
    op.create_index(
        "ix_listing_snapshots_valuation_key_observed",
        "listing_snapshots",
        ["valuation_key", "observed_at"],
        unique=False,
    )

    op.create_table(
        "saved_search_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("saved_search_id", sa.Integer(), nullable=False),
        sa.Column("saved_search_query", sa.String(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("items_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_saved_search_notifications_user_id",
        "saved_search_notifications",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_saved_search_notifications_saved_search_id",
        "saved_search_notifications",
        ["saved_search_id"],
        unique=False,
    )
    op.create_index(
        "ix_saved_search_notifications_created_at",
        "saved_search_notifications",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_saved_search_notifications_read_at",
        "saved_search_notifications",
        ["read_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_saved_search_notifications_read_at", table_name="saved_search_notifications")
    op.drop_index("ix_saved_search_notifications_created_at", table_name="saved_search_notifications")
    op.drop_index("ix_saved_search_notifications_saved_search_id", table_name="saved_search_notifications")
    op.drop_index("ix_saved_search_notifications_user_id", table_name="saved_search_notifications")
    op.drop_table("saved_search_notifications")

    op.drop_index("ix_listing_snapshots_valuation_key_observed", table_name="listing_snapshots")
    op.drop_index(
        "ix_listing_snapshots_saved_search_listing_observed",
        table_name="listing_snapshots",
    )
    op.drop_index("ix_listing_snapshots_observed_at", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_valuation_key", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_query", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_listing_fingerprint", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_source", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_saved_search_id", table_name="listing_snapshots")
    op.drop_index("ix_listing_snapshots_user_id", table_name="listing_snapshots")
    op.drop_table("listing_snapshots")

    op.drop_column("saved_searches", "last_alert_notified_at")
    op.drop_column("saved_searches", "last_alert_checked_at")
    op.drop_column("saved_searches", "alerts_enabled")
