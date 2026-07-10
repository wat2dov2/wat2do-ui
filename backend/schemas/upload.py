"""Response schemas for the /uploads/* endpoints.

All upload handlers return the same ``{"url": str}`` shape; typing it
explicitly locks the OpenAPI contract so future additions cannot leak
silently.
"""

from pydantic import BaseModel


class UploadResponse(BaseModel):
    url: str
