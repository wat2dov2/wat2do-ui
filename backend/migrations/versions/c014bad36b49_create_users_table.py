"""create users table

Revision ID: c014bad36b49
Revises: 
Create Date: 2026-03-09 00:40:17.118592

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c014bad36b49'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('users',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('supabase_auth_id', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('username', sa.String(length=100), nullable=True),
        sa.Column('full_name', sa.String(length=255), nullable=True),
        sa.Column('avatar_url', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('username'),
    )
    op.create_index(op.f('ix_users_supabase_auth_id'), 'users', ['supabase_auth_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_supabase_auth_id'), table_name='users')
    op.drop_table('users')
