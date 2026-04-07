import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { GOOSE_IMAGE_PATH } from "@/shared/constants/images";
import { useTypewriter } from "@/shared/hooks/useTypewriter";

interface GooseDialogueProps {
  message: string;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
}

export function GooseDialogue({
  message,
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  showBack = true,
}: GooseDialogueProps) {
  const { displayed, done, skip } = useTypewriter(message);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <img
          src={GOOSE_IMAGE_PATH}
          alt="Mr. Goose"
          className="w-16 h-16 object-contain shrink-0 -mt-1"
        />

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <Badge variant="new" className="w-fit text-xs font-medium px-2 py-0.5 mb-2">Mr. Goose</Badge>
            <p
              className="text-lg text-foreground leading-relaxed mt-1 cursor-pointer"
              onClick={!done ? skip : undefined}
            >
              {displayed}
              {!done && <span className="inline-block w-[2px] h-[1em] bg-foreground align-text-bottom ml-px animate-pulse" />}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {showBack && onBack && (
              <Button type="button" variant="secondary" size="sm" onClick={onBack}>
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={onNext}
              disabled={nextDisabled}
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
