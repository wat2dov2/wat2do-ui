import { useTranslation } from "react-i18next";
import { formatInTimeZone } from "date-fns-tz";
import type { ClubSubmission } from "@/features/admin/api/admin.api";
import { AdminStatusBadge } from "@/features/admin/components/shared/AdminStatusBadge";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/shared/ui/drawer";
import { DrawerBody, Section, Stack } from "@/shared/layout";
import { Link } from "@/shared/ui/link";
import { isSafeUrl, normalizeInstagramHandle } from "@/shared/utils/url";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

export function ClubSubmissionDetailsDrawer({ submission, onClose }: { submission: ClubSubmission; onClose: () => void }) {
  const { t } = useTranslation();
  const { getSchoolName, getSchoolTimezone } = useSchoolDirectory();
  const instagramHandle = normalizeInstagramHandle(submission.ig);
  const links = [
    { label: t("forms.clubPageUrl"), url: submission.club_page },
    { label: t("admin.instagram"), url: instagramHandle ? `https://www.instagram.com/${instagramHandle}/` : null },
    { label: t("admin.discord"), url: submission.discord },
    { label: t("common.logo"), url: submission.logo_url },
  ];
  return (
    <Drawer open onOpenChange={open => { if (!open) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{submission.club_name}</DrawerTitle>
          <DrawerDescription>{t("admin.clubSubmissions")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <Stack direction="horizontal" align="center" gap={3}>
            <AvatarStack avatars={[{ name: submission.club_name, src: submission.logo_url ?? "" }]} />
            <AdminStatusBadge status={submission.status} />
          </Stack>
          <Section title={t("schools.school")}><p>{getSchoolName(submission.school)}</p></Section>
          <Section title={t("forms.ownerEmail")}><p>{submission.owner_email || "-"}</p></Section>
          <Section title={t("admin.submittedBy")}><p>{submission.submitted_by_email || "-"}</p></Section>
          <Section title={t("admin.submittedAt")}><p>{submission.created_at ? formatInTimeZone(submission.created_at, getSchoolTimezone(submission.school), "yyyy-MM-dd HH:mm:ss zzz") : "-"}</p></Section>
          <Section title={t("admin.clubType")}><p>{submission.club_type}</p></Section>
          <Section title={t("forms.categories")}><p>{submission.categories?.join(", ") || "-"}</p></Section>
          {links.map(({ label, url }) => <Section key={label} title={label}>{url && isSafeUrl(url) ? <Link href={url} target="_blank" rel="noopener noreferrer">{url}</Link> : <p>{url || "-"}</p>}</Section>)}
          <Section title={t("admin.clubSubmissionDetails.records")}>
            <p>{t("admin.clubSubmissionDetails.clubId", { id: submission.id })}</p>
            <p>{t("admin.clubSubmissionDetails.ownerId", { id: submission.created_by || "-" })}</p>
            <p>{t("clubs.eventCount", { count: submission.event_count ?? 0 })}</p>
            <p>{t("clubs.positionCount", { count: submission.position_count ?? 0 })}</p>
          </Section>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
