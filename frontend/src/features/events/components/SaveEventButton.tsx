import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useSavedEventToggle } from "@/features/events/hooks/useSavedEvents";
import { Button } from "@/shared/ui/button";
import { IconSwap } from "@/shared/ui/icon-swap";

/** "Save", or "Saved" once it is, in one slot as wide as the longer word. */
function SaveLabel({ saved }: { saved: boolean }) {
  const { t } = useTranslation();
  return (
    <IconSwap
      showAlternate={saved}
      icon={t("events.savedEvents.save")}
      alternate={t("events.savedEvents.saved")}
    />
  );
}

/**
 * Saves the event to the visitor's profile, or takes it off; a signed-out
 * visitor signs in first. It keeps one size either way, so the actions
 * beside it never move.
 */
export function SaveEventButton({ eventId }: { eventId: number }) {
  const signedIn = useSignedInAction();
  const saved = useSavedEventToggle(eventId);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      selected={saved.isSaved}
      selectionIndicator="none"
      disabled={saved.isPending}
      onClick={() => signedIn(saved.toggle)}
    >
      <Bookmark />
      <SaveLabel saved={saved.isSaved} />
    </Button>
  );
}

/** The same button, inert, while the event loads. */
export function SaveEventButtonPlaceholder() {
  return (
    <Button type="button" variant="outline" size="sm" disabled tabIndex={-1}>
      <Bookmark />
      <SaveLabel saved={false} />
    </Button>
  );
}
