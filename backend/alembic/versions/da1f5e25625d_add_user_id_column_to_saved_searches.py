from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "da1f5e25625d"
down_revision: Union[str, Sequence[str], None] = "0bf90a4f98ad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saved_searches", sa.Column("user_id", sa.String(), nullable=True))
    op.create_index("ix_saved_searches_user_id", "saved_searches", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_saved_searches_user_id", table_name="saved_searches")
    op.drop_column("saved_searches", "user_id")
