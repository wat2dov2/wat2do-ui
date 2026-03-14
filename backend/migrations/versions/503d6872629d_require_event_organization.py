"""require event organization

Revision ID: 503d6872629d
Revises: be3c90f6a8e8
Create Date: 2026-03-09 22:13:26.983789

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '503d6872629d'
down_revision: Union[str, None] = 'be3c90f6a8e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill any existing NULL/blank organizations before enforcing NOT NULL.
    op.execute(
        """
        update events
        set organization = coalesce(nullif(btrim(organization), ''), nullif(btrim(display_handle), ''), 'Unknown')
        where organization is null or btrim(organization) = '';
        """
    )
    op.alter_column("events", "organization", existing_type=sa.String(length=255), nullable=False)


def downgrade() -> None:
    op.alter_column("events", "organization", existing_type=sa.String(length=255), nullable=True)
