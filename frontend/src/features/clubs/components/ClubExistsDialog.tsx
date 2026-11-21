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
  /** The club the school already lists with the Instagram account sent; null keeps the dialog closed. */
  club: ApiClubExistsResponse | null;
  onClose: () => void;
}

/** A club cannot be added twice: its page is where someone who runs it claims it or joins its team. */
export function ClubExistsDialog({ club, onClose }: ClubExistsDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={club != null} onOpenChange={(open) => !open && onClose()}>
      {club ? (
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t("clubs.exists.title")}</DialogTitle>
            <DialogDescription>
              {t("clubs.exists.description", { club: club.club_name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <NextLink href={clubPagePath(club.club_id)}>{t("clubs.exists.open")}</NextLink>
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
