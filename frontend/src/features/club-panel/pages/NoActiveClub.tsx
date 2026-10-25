import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/shared/feedback";

/** Shown on a club panel page when no club is picked in the menu's Club Panel dropdown. */
export function NoActiveClub() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={t("clubPanel.noActiveClubSelected")}
      description={t("clubPanel.noActiveClubSelectedDesc")}
    />
  );
}
