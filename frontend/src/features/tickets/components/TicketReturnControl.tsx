import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useReturnTicket } from "@/features/tickets/hooks/useTickets";
import type { ApiTicketResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { LoadingButton } from "@/shared/ui/loading-button";

interface TicketReturnControlProps {
  ticket: ApiTicketResponse;
  /** After the ticket is gone, e.g. leave its page. */
  onReturned?: () => void;
}

/** The holder of a free ticket gives it back, so someone else can take the seat. */
export function TicketReturnControl({ ticket, onReturned }: TicketReturnControlProps) {
  const { t } = useTranslation();
  const giveBack = useReturnTicket(ticket.event_id);
  const [open, setOpen] = useState(false);
  if (!ticket.can_return) return null;

  return (
    <>
      <Button type="button" variant="link" size="inline" onClick={() => setOpen(true)}>
        {t("tickets.return.prompt")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("tickets.return.title")}</DialogTitle>
            <DialogDescription>{t("tickets.return.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("tickets.return.keep")}
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              isLoading={giveBack.isPending}
              onClick={() =>
                giveBack.mutate(ticket.code, {
                  onSuccess: () => {
                    setOpen(false);
                    toast({ description: t("tickets.return.done") });
                    onReturned?.();
                  },
                })
              }
            >
              {t("tickets.return.confirm")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
