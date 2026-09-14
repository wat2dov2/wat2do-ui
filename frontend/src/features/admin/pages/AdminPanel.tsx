import { useTranslation } from "react-i18next";
import { Building2, Users, Calendar, Instagram, Megaphone, Settings, Shield } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { AdminCard } from "@/shared/ui/AdminCard";
import { Stack } from "@/shared/layout/stack";
import { FormGrid } from "@/shared/layout/form-grid";
import { PageHeader } from "@/shared/layout/page-header";
import { useAdminPanel } from "@/features/admin/hooks/useAdminPanel";
import { type AdminRouteKey } from "@/shared/constants/routes";

interface AdminPanelProps {
  onNavigate: (page: AdminRouteKey) => void;
}

export function AdminPanel({ onNavigate }: AdminPanelProps) {
  const { t } = useTranslation();
  const { counts, loadFailed, retry } = useAdminPanel();

  return (
    <Stack gap={5}>
      <PageHeader icon={Shield} title={t("navigation.adminPanel")} description={t("admin.panelDescription")} />
      {loadFailed ? (
        <Stack align="start" gap={2} role="alert">
          <p>{t("admin.pendingCountsError")}</p>
          <Button variant="outline" onClick={retry}>{t("common.tryAgain")}</Button>
        </Stack>
      ) : null}
      <FormGrid columns={3}>
        <AdminCard icon={Calendar} title={t("navigation.events")} description={t("admin.manageEventsDesc")}
          pendingCounts={[
            { label: t("admin.eventSubmissions"), count: counts.eventSubmissions },
            { label: t("admin.eventReports"), count: counts.eventReports },
          ]}
          onClick={() => onNavigate("admin-events")} />
        <AdminCard icon={Building2} title={t("navigation.clubs")} description={t("admin.manageClubsDescAlt")}
          pendingCounts={[
            { label: t("admin.clubSubmissions"), count: counts.clubSubmissions },
            { label: t("admin.claimRequests"), count: counts.claims },
          ]}
          onClick={() => onNavigate("admin-clubs")} />
        <AdminCard icon={Users} title={t("navigation.positions")} description={t("positions.searchPlaceholder")}
          pendingCounts={[{ label: t("positions.submissions"), count: counts.positionSubmissions }]}
          onClick={() => onNavigate("admin-positions")} />
        <AdminCard icon={Megaphone} title={t("admin.posters")} description={t("admin.managePostersDescAlt")}
          pendingCounts={[{ label: t("admin.posterPayouts.tabs.payouts"), count: counts.payouts }]}
          onClick={() => onNavigate("admin-posters")} />
        <AdminCard icon={Instagram} title={t("admin.instagramPublishing.title")} description={t("admin.instagramPublishing.cardDescription")}
          onClick={() => onNavigate("admin-instagram")} />
        <AdminCard icon={Settings} title={t("admin.diagnostics.title")} description={t("admin.diagnostics.cardDescription")}
          onClick={() => onNavigate("admin-diagnostics")} />
      </FormGrid>
    </Stack>
  );
}
