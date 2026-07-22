"""Credit and promotion package constants."""

from core.product_control import product_control

_CONTROL = product_control.credits

DEFAULT_CREDIT_BALANCE = _CONTROL.new_user_balance
MAX_CREDITS_PER_ADD = _CONTROL.maximum_admin_add
DEFAULT_PROMOTION_PACKAGE = _CONTROL.default_promotion_package
PROMOTION_PACKAGES: dict[str, tuple[int, int]] = {
    name: (package.credits, package.days) for name, package in _CONTROL.promotion_packages.items()
}
