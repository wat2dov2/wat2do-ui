from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EmailFoundBy = Literal["club_page", "research"]

_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_HTTPS = r"^https://\S+$"


class FoundClubEmail(BaseModel):
    """A club's email and the public page it is printed on, checked before it is stored."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    email: str = Field(pattern=_EMAIL, max_length=254)
    source_url: str = Field(pattern=_HTTPS, max_length=2000)

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()


_CLAIM_URL = "{{claim_url}}"


class Pitch(BaseModel):
    """Claude's verdict on a lead's club and, for a fit, its video script and email.

    A fit's email names the claim link exactly once as ``{{claim_url}}`` (the admin
    page fills it in), and nothing written carries another link, a template key or
    an em dash.
    """

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    fit: bool
    reason: str = Field(min_length=1, max_length=500)
    script: str = ""
    email_subject: str = ""
    email_body: str = ""

    @model_validator(mode="after")
    def _written_for_a_fit(self) -> "Pitch":
        if not self.fit:
            self.script = self.email_subject = self.email_body = ""
            return self
        if not (300 <= len(self.script) <= 3000):
            raise ValueError("script must be 300 to 3000 characters")
        if not (1 <= len(self.email_subject) <= 150):
            raise ValueError("email subject must be 1 to 150 characters")
        if self.email_body.count(_CLAIM_URL) != 1:
            raise ValueError("email body must name {{claim_url}} exactly once")
        texts = (self.reason, self.script, self.email_subject, self.email_body)
        if any("—" in text for text in texts):
            raise ValueError("no em dashes")
        if any("http" in text.lower() or "www." in text.lower() for text in texts):
            raise ValueError("no links but the claim link")
        if any("{{" in text for text in texts[:3]) or "{{" in self.email_body.replace(
            _CLAIM_URL, ""
        ):
            raise ValueError("no template keys but the claim link")
        return self
