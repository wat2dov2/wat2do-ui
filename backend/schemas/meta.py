"""Response schema for the /meta/constants endpoint."""

from pydantic import BaseModel


class AppConstantsResponse(BaseModel):
    """Shared domain constants that the frontend must stay in sync with.

    The frontend fetches this once on app init so both layers
    always agree on categories, interest mappings, and status enums.
    """

    event_categories: list[str]
    organization_categories: list[str]
    interests: list[str]
    interest_to_categories: dict[str, list[str]]
    report_statuses: list[str]
