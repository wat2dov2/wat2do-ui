"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { ClubDetailsSkeleton } from "@/features/clubs/components/ClubDetailsSkeleton";
import { ClubPagePreview } from "@/features/clubs/pages/ClubDetailsPage";
import { DialogBody } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import type { Club } from "@/shared/types";

/**
 * "Preview club": the club's public page as someone outside the club sees it,
 * in a dialog over the club panel. `club` is undefined until it loads.
 */
export function ClubPreview({ club }: { club: Club | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye />
        {t("clubPanel.preview.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="page">
          <DialogHeader>
            <DialogTitle>
              <Badge variant="muted" asChild><span>{t("clubPanel.preview.badge")}</span></Badge> {t("clubPanel.preview.title")}
            </DialogTitle>
            <DialogDescription>{t("clubPanel.preview.description")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {club ? <ClubPagePreview club={club} /> : <ClubDetailsSkeleton />}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
