"""A/B experiment constants."""

from typing import Final

AB_EVENT_IMPRESSION = "impression"
AB_EVENT_CLICK = "click"

AB_VARIANT_CONTROL: Final = "control"
AB_VARIANT_TREATMENT: Final = "treatment"
AB_DEFAULT_VARIANTS = (AB_VARIANT_CONTROL, AB_VARIANT_TREATMENT)
