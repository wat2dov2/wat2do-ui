import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useSavedEventToggle } from "@/features/events/hooks/useSavedEvents";
import { Button } from "@/shared/ui/button";

/**
 * Saves the event to the visitor's profile, or takes it off; a signed-out
 * visitor signs in first. It keeps one size either way, so the actions
 * beside it never move.
 */
export function SaveEventButton({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const signedIn = useSignedInAction();
  const saved = useSavedEventToggle(eventId);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={saved.isSaved ? t("events.savedEvents.unsave") : t("events.savedEvents.save")}
      selected={saved.isSaved}
      disabled={saved.isPending}
      onClick={() => signedIn(saved.toggle)}
    >
      <Bookmark />
    </Button>
  );
}

/** The same button, inert, while the event loads. */
export function SaveEventButtonPlaceholder() {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="outline" size="icon-sm" disabled tabIndex={-1} aria-label={t("events.savedEvents.save")}>
      <Bookmark />
    </Button>
  );
}
