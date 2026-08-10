from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from core.controlbox import controlbox

_CONTACT = controlbox.contact


class ContactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    message: str = Field(min_length=1, max_length=_CONTACT.maximum_message_length)

    @field_validator("message")
    @classmethod
    def _strip_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value cannot be blank")
        return stripped
