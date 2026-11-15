import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useSavedPositionToggle } from "@/features/positions/hooks/useSavedPositions";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/** Saving a position to the visitor's profile, or taking it off; a signed-out visitor signs in first. */
function useSavePosition(positionId: number) {
  const { t } = useTranslation();
  const signedIn = useSignedInAction();
  const saved = useSavedPositionToggle(positionId);
  return {
    ...saved,
    label: saved.isSaved ? t("positions.saved.saved") : t("positions.saved.save"),
    onToggle: () => signedIn(saved.toggle),
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
      disabled={save.isPending}
      onClick={save.onToggle}
    >
      <Bookmark className={save.isSaved ? "fill-current" : undefined} />
      {save.label}
    </Button>
  );
}

/**
 * The same toggle as an icon badge in a position card's corner, where a
 * phone's narrow card has no room for its word. It saves without opening the
 * card the press lands on.
 */
export function SavePositionBadge({ positionId }: { positionId: number }) {
  const save = useSavePosition(positionId);
  return (
    <Badge asChild variant={save.isSaved ? "default" : "secondary"} size="md">
      <button
        type="button"
        aria-pressed={save.isSaved}
        aria-label={save.label}
        disabled={save.isPending}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          save.onToggle();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Bookmark className={save.isSaved ? "fill-current" : undefined} />
      </button>
    </Badge>
  );
}
