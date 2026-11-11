"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuthState, useSessionKnown } from "@/features/auth/hooks/useAuthState";
import { appendSafeReturnTo } from "@/features/auth/utils/returnTo";
import { ROUTES } from "@/shared/constants/routes";
import { Badge } from "@/shared/ui/badge";

/**
 * Beside a form's title for signed-out readers: the form submits only once they
 * sign in, and the badge takes them to sign in and back here. Hidden until the
 * session is known, so a signed-in reader never sees it flash.
 */
export function LoginRequiredBadge() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthState();
  const sessionKnown = useSessionKnown();
  if (!sessionKnown || isAuthenticated) return null;
  return (
    <Badge asChild variant="muted" size="md">
      <NextLink href={appendSafeReturnTo(ROUTES.LOGIN, pathname)}>{t("auth.loginRequired")}</NextLink>
    </Badge>
  );
}
