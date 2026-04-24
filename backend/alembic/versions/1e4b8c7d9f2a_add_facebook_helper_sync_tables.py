from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "1e4b8c7d9f2a"
down_revision: Union[str, Sequence[str], None] = "8d4e7b1a9c2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_facebook_credentials",
        sa.Column("credential_source", sa.String(), nullable=False, server_default="manual_upload"),
    )
    op.add_column(
        "user_facebook_credentials",
        sa.Column("session_cookie_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "user_facebook_credentials",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_facebook_credentials",
        sa.Column("earliest_cookie_expiry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_facebook_credentials",
        sa.Column("helper_label", sa.String(length=120), nullable=True),
    )
    op.alter_column("user_facebook_credentials", "credential_source", server_default=None)
    op.alter_column("user_facebook_credentials", "session_cookie_count", server_default=None)

    op.create_table(
        "facebook_sync_pairing_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("code_hash_sha256", sa.String(length=64), nullable=False),
        sa.Column("helper_label", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_facebook_sync_pairing_sessions_user_id",
        "facebook_sync_pairing_sessions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_facebook_sync_pairing_sessions_code_hash_sha256",
        "facebook_sync_pairing_sessions",
        ["code_hash_sha256"],
        unique=True,
    )

    op.create_table(
        "facebook_sync_clients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("token_hash_sha256", sa.String(length=64), nullable=False),
        sa.Column("helper_label", sa.String(length=120), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_facebook_sync_clients_user_id",
        "facebook_sync_clients",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_facebook_sync_clients_token_hash_sha256",
        "facebook_sync_clients",
        ["token_hash_sha256"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_facebook_sync_clients_token_hash_sha256", table_name="facebook_sync_clients")
    op.drop_index("ix_facebook_sync_clients_user_id", table_name="facebook_sync_clients")
    op.drop_table("facebook_sync_clients")

    op.drop_index(
        "ix_facebook_sync_pairing_sessions_code_hash_sha256",
        table_name="facebook_sync_pairing_sessions",
    )
    op.drop_index("ix_facebook_sync_pairing_sessions_user_id", table_name="facebook_sync_pairing_sessions")
    op.drop_table("facebook_sync_pairing_sessions")

    op.drop_column("user_facebook_credentials", "helper_label")
    op.drop_column("user_facebook_credentials", "earliest_cookie_expiry_at")
    op.drop_column("user_facebook_credentials", "last_synced_at")
    op.drop_column("user_facebook_credentials", "session_cookie_count")
    op.drop_column("user_facebook_credentials", "credential_source")
