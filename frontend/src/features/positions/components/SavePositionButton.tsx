import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useSavedPositionToggle } from "@/features/positions/hooks/useSavedPositions";
import { useTurnOnPop } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/** Saving a position to the visitor's profile, or taking it off; a signed-out visitor signs in first. */
function useSavePosition(positionId: number) {
  const { t } = useTranslation();
  const signedIn = useSignedInAction();
  const saved = useSavedPositionToggle(positionId);
  const pop = useTurnOnPop(saved.isSaved);
  return {
    isSaved: saved.isSaved,
    label: saved.isSaved ? t("positions.saved.saved") : t("positions.saved.save"),
    iconClassName: cn(saved.isSaved && "fill-current", pop.pop && "animate-success-pulse"),
    onToggle: () => signedIn(() => {
      pop.press();
      saved.toggle();
    }),
  };
}

/** The position drawer's Save toggle: it reads "Saved" and stays selected once saved. */
export function SavePositionButton({ positionId }: { positionId: number }) {
  const save = useSavePosition(positionId);
  return (
    <Button
      type="button"
      variant="outline"
      selected={save.isSaved}
      selectionIndicator="none"
      onClick={save.onToggle}
    >
      <Bookmark className={save.iconClassName} />
      {save.label}
    </Button>
  );
}

/**
 * The same toggle as an icon badge in a position card's corner, where a
 * phone's narrow card has no room for its word. It saves without opening the
 * card the press lands on, and takes a fingertip-sized press around the badge.
 */
export function SavePositionBadge({ positionId }: { positionId: number }) {
  const save = useSavePosition(positionId);
  return (
    <Badge asChild variant={save.isSaved ? "default" : "secondary"} size="lg">
      <button
        type="button"
        aria-pressed={save.isSaved}
        aria-label={save.label}
        className="relative hit-area"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          save.onToggle();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Bookmark className={save.iconClassName} />
      </button>
    </Badge>
  );
}
