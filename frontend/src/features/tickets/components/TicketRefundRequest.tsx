import { useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { appendSafeReturnTo, useAuthState } from "@/features/auth";
import { useTicketRefundRequest } from "@/features/tickets/hooks/useTickets";
import { formatDay, refundRequestState } from "@/features/tickets/lib/ticketFormat";
import { ROUTES } from "@/shared/constants/routes";
import type { ApiTicketResponse } from "@/shared/generated";
import { toast } from "@/shared/hooks/use-toast";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { FormTextarea } from "@/shared/ui/form-field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { LoadingButton } from "@/shared/ui/loading-button";

// The backend keeps a holder's note to the club this short.
const NOTE_MAX_LENGTH = 500;

interface TicketRefundRequestProps {
  ticket: ApiTicketResponse;
  /** Arrived from an email offering a refund: open the request straight away. */
  offered?: boolean;
}

/** The holder asks the club for their money back here, and sees where that request stands. */
export function TicketRefundRequest({ ticket, offered = false }: TicketRefundRequestProps) {
  const { t, i18n } = useTranslation();
  const pathname = usePathname();
  const { isAuthenticated } = useAuthState();
  const request = useTicketRefundRequest(ticket.code);
  const [open, setOpen] = useState(offered && ticket.can_request_refund);
  const [note, setNote] = useState("");
  const club = ticket.club_name ?? t("tickets.refund.theClub");
  const state = refundRequestState(ticket);

  if (state === "declined") {
    return (
      <Alert variant="warning">
        <AlertDescription>
          {t("tickets.refund.declined", {
            club,
            date: formatDay(ticket.refund_declined_at, i18n.language),
          })}
        </AlertDescription>
      </Alert>
    );
  }
  if (state === "waiting") {
    return (
      <Alert>
        <AlertDescription>
          {t("tickets.refund.pending", {
            club,
            date: formatDay(ticket.refund_requested_at, i18n.language),
          })}
        </AlertDescription>
      </Alert>
    );
  }
  // Someone who followed a refund offer while signed out signs in, then lands back here.
  const signIn = offered && !isAuthenticated && ticket.status === "valid";
  if (!ticket.can_request_refund && !signIn) return null;

  const send = () =>
    request.mutate(note, {
      onSuccess: () => {
        setOpen(false);
        toast({ description: t("tickets.refund.sent", { club }), variant: "success" });
      },
    });

  return (
    <>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{t("tickets.refund.prompt")}</ItemTitle>
          <ItemDescription className="line-clamp-none">
            {t("tickets.refund.promptDescription", { club })}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {signIn ? (
            <Button variant="outline" size="sm" asChild>
              <NextLink href={appendSafeReturnTo(ROUTES.LOGIN, `${pathname}?refund=1`)}>
                {t("tickets.refund.signIn")}
              </NextLink>
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t("tickets.refund.request")}
            </Button>
          )}
        </ItemActions>
      </Item>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("tickets.refund.title", { club })}</DialogTitle>
            <DialogDescription>{t("tickets.refund.description", { club })}</DialogDescription>
          </DialogHeader>
          <FormTextarea
            name={`refund-note-${ticket.code}`}
            label={t("tickets.refund.noteLabel")}
            placeholder={t("tickets.refund.notePlaceholder")}
            rows={3}
            value={note}
            onChange={(value) => setNote(value.slice(0, NOTE_MAX_LENGTH))}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <LoadingButton type="button" isLoading={request.isPending} onClick={send}>
              {t("tickets.refund.send")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
