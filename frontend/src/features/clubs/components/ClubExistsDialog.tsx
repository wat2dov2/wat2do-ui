import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { clubPagePath } from "@/shared/constants/routes";
import type { ApiClubExistsResponse } from "@/shared/generated";

interface ClubExistsDialogProps {
  /** The club the school already lists for what was sent; null keeps the dialog closed. */
  club: ApiClubExistsResponse | null;
  onClose: () => void;
  /** Sends the club again as a different club than a similarly named one. */
  onAddDifferentClub: () => void;
}

/**
 * A club cannot be added twice: its page is where someone who runs it claims it or joins its team.
 * The same Instagram account or name is refused; a name only like it asks whether it is that club.
 */
export function ClubExistsDialog({ club, onClose, onAddDifferentClub }: ClubExistsDialogProps) {
  const { t } = useTranslation();
  const similar = club?.matched === "similar_name";
  return (
    <Dialog open={club != null} onOpenChange={(open) => !open && onClose()}>
      {club ? (
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{similar ? t("clubs.exists.similarTitle") : t("clubs.exists.title")}</DialogTitle>
            <DialogDescription>
              {{
                instagram: t("clubs.exists.description", { club: club.club_name }),
                name: t("clubs.exists.nameDescription", { club: club.club_name }),
                similar_name: t("clubs.exists.similarDescription", { club: club.club_name }),
              }[club.matched]}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {similar ? (
              <Button type="button" variant="outline" onClick={onAddDifferentClub}>
                {t("clubs.exists.differentClub")}
              </Button>
            ) : null}
            <Button asChild>
              <NextLink href={clubPagePath(club.club_id)}>{t("clubs.exists.open")}</NextLink>
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
