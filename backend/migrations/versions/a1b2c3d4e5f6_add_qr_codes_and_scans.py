"""add qr_codes and qr_code_scans tables

Revision ID: a1b2c3d4e5f6
Revises: 503d6872629d
Create Date: 2026-03-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "503d6872629d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "qr_codes",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("destination_type", sa.String(length=32), nullable=False),
        sa.Column("destination_id", sa.String(length=512)),
        sa.Column("filters", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("image_url", sa.String(length=1024)),
        sa.Column("latitude", sa.Float(), server_default="0"),
        sa.Column("longitude", sa.Float(), server_default="0"),
    )
    op.create_table(
        "qr_code_scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("qr_code_id", sa.String(length=64), sa.ForeignKey("qr_codes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("scanned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("user_id", sa.String(length=255)),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("conversion_actions", postgresql.JSONB(), server_default="[]"),
        sa.Column("user_agent", sa.String(length=512)),
    )


def downgrade() -> None:
    op.drop_table("qr_code_scans")
    op.drop_table("qr_codes")
