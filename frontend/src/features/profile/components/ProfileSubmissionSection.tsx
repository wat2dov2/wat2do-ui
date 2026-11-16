import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { ProfileListSection, ProfileRow } from "@/features/profile/components/ProfileListSection";
import type { ProfileSubmissionRow } from "@/features/profile/hooks/useMySubmissions";
import { ImageTile } from "@/shared/ui/tile";

interface ProfileSubmissionSectionProps {
  title: string;
  rows: ProfileSubmissionRow[];
  isPending: boolean;
  /** The kind's icon, for a row without an image and for the empty list. */
  icon: LucideIcon;
  /** What the list holds once the visitor submits something, and the form that does it. */
  empty: { text: string; action: { label: string; href: string } };
}

/** The things of one kind the visitor submitted: each with where it stands in review and when it was sent. */
export function ProfileSubmissionSection({ title, rows, isPending, icon: Icon, empty }: ProfileSubmissionSectionProps) {
  const { t, i18n } = useTranslation();
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", year: "numeric" });
  return (
    <ProfileListSection
      title={title}
      rows={rows}
      isPending={isPending}
      empty={{ icon: Icon, ...empty }}
      rowKey={(row) => row.key}
      renderRow={(row) => {
        const status = t(`profile.submissions.status.${row.status}`);
        return (
          <ProfileRow
            media={<ImageTile src={row.image?.src ?? null} kind={row.image?.kind ?? "poster"} fallback={<Icon aria-hidden="true" className="size-4" />} />}
            title={row.title}
            description={
              row.submittedAt
                ? t("profile.submissions.statusOn", { status, date: dateFormat.format(new Date(row.submittedAt)) })
                : status
            }
            target={row.href ? { href: row.href } : null}
          />
        );
      }}
    />
  );
}
