import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase } from "lucide-react";
import { formatPositionDeadlineBadge, PositionDetailsDrawer } from "@/features/positions";
import { ProfileListSection, ProfileRow } from "@/features/profile/components/ProfileListSection";
import { rowImage } from "@/features/profile/hooks/useProfileEvents";
import { ROUTES } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Position } from "@/shared/types";
import { ImageTile } from "@/shared/ui/tile";

/** The positions the visitor saved, as rows like their events; a row opens the position in its drawer. */
export function ProfilePositionSection({ positions, isPending }: { positions: Position[]; isPending: boolean }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const [openId, setOpenId] = useState<number | null>(null);
  const open = positions.find((position) => position.id === openId) ?? null;

  return (
    <>
      <ProfileListSection
        title={t("profile.positions.saved")}
        rows={positions}
        isPending={isPending}
        empty={{ icon: Briefcase, text: t("positions.saved.emptyDescription"), action: { label: t("positions.allPositions"), href: ROUTES.POSITIONS } }}
        rowKey={(position) => position.id}
        renderRow={(position) => {
          const deadline = formatPositionDeadlineBadge(position, i18n.language, getSchoolTimezone(position.school));
          const image = rowImage(position.source_image_url, position.club_logo_url);
          return (
            <ProfileRow
              media={<ImageTile src={image?.src ?? null} kind={image?.kind ?? "poster"} fallback={<Briefcase aria-hidden="true" className="size-4" />} />}
              title={position.title}
              description={[position.club_name, deadline ? t("profile.positions.deadline", { date: deadline }) : null].filter(Boolean).join(" · ")}
              target={{ onOpen: () => setOpenId(position.id) }}
            />
          );
        }}
      />
      <PositionDetailsDrawer
        positions={positions}
        onSelect={(position) => setOpenId(position.id)}
        position={open}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
