import { useTranslation } from "react-i18next";

import {
  usePromoterBannerDismissal,
  usePromoterState,
} from "@/features/posters/hooks/usePromoterState";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import { ROUTES } from "@/shared/constants/routes";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Megaphone, X } from "@/shared/ui/doodle-icons";
import { Link } from "@/shared/ui/link";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { formatCadCents } from "@/shared/utils/currency";

export function PromoterRecruitmentBanner() {
  const { t, i18n } = useTranslation();
  const promoter = usePromoterState();
  const dismissal = usePromoterBannerDismissal();

  if (
    !promoter.isAuthenticated ||
    !promoter.school ||
    promoter.isEnrolled ||
    !promoter.isProgramEnabled ||
    dismissal.isDismissed
  ) {
    return null;
  }

  return (
    <Alert
      variant="info"
      className="grid-cols-[auto_1fr_auto]"
      data-testid="promoter-recruitment-banner"
    >
      <Link
        href={ROUTES.PROMOTE}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("posters.recruitment.seeHowItWorks")}
      />
      <Megaphone />
      <AlertTitle className="relative pointer-events-none">
        {t("posters.recruitment.title", {
          school: getSchoolDisplayName(promoter.school),
        })}
      </AlertTitle>
      <AlertDescription className="relative pointer-events-none">
        <p>
          {t("posters.recruitment.description", {
            rate: formatCadCents(promoterProgram.rateCents, i18n.language),
          })}
        </p>
        <span className="font-semibold text-primary">
          {t("posters.recruitment.seeHowItWorks")}
        </span>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative z-10 col-start-3 row-span-2 row-start-1"
        onClick={dismissal.dismiss}
        aria-label={t("posters.recruitment.dismiss", {
          days: promoterProgram.bannerDismissalDays,
        })}
      >
        <X />
      </Button>
    </Alert>
  );
}
