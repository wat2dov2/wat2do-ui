"""add user_interactions, user_saved_events, user_recommendations, ab_test_events tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- user_interactions: raw interaction events --
    op.create_table(
        "user_interactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("interaction_type", sa.String(length=32), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_user_interactions_user_event", "user_interactions", ["user_id", "event_id"])
    op.create_index("ix_user_interactions_event_id", "user_interactions", ["event_id"])
    op.create_index("ix_user_interactions_created_at", "user_interactions", ["created_at"])

    # -- user_saved_events: bookmarks --
    op.create_table(
        "user_saved_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "event_id", name="uq_user_saved_events_user_event"),
    )
    op.create_index("ix_user_saved_events_user_id", "user_saved_events", ["user_id"])

    # -- user_recommendations: pre-computed nightly results --
    op.create_table(
        "user_recommendations",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("predicted_score", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "event_id"),
    )
    op.create_index("ix_user_recommendations_user_rank", "user_recommendations", ["user_id", "rank"])

    # -- ab_test_events: A/B test tracking --
    op.create_table(
        "ab_test_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("variant", sa.String(length=32), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ab_test_events_variant", "ab_test_events", ["variant"])


def downgrade() -> None:
    op.drop_table("ab_test_events")
    op.drop_table("user_recommendations")
    op.drop_table("user_saved_events")
    op.drop_table("user_interactions")
