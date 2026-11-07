"""Carousel batch shapes the daily drafts and the scheduled publish share.

The admin routes' request and response models live with the API
(``rust/src/api/routes/instagram_publishing``).
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

InstagramPublishBatchKind = Literal["events", "employers_on_campus"]


class InstagramPublishBatchPublish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(gt=0)
