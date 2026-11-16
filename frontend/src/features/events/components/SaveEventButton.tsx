import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useSavedEventToggle } from "@/features/events/hooks/useSavedEvents";
import { useTurnOnPop } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
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
 * beside it never move. The change shows at once and the request follows
 * (a failure puts it back), so it never waits on the network.
 */
export function SaveEventButton({ eventId }: { eventId: number }) {
  const signedIn = useSignedInAction();
  const saved = useSavedEventToggle(eventId);
  const pop = useTurnOnPop(saved.isSaved);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      selected={saved.isSaved}
      selectionIndicator="none"
      onClick={() => signedIn(() => {
        pop.press();
        saved.toggle();
      })}
    >
      <Bookmark className={cn(saved.isSaved && "fill-current", pop.pop && "animate-success-pulse")} />
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
