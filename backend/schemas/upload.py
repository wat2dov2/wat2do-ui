"""Response schemas for the /uploads/* endpoints (audit S7).

All upload handlers return the same ``{"url": str}`` shape; typing it
explicitly locks the OpenAPI contract so future additions cannot leak
silently.
"""

from pydantic import BaseModel


class UploadResponse(BaseModel):
    """Public URL of the freshly-uploaded object."""

    url: str
