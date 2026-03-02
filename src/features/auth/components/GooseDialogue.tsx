import { Button } from "@/shared/ui/button";

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
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <img
          src="/images/mr-goose.png"
          alt="Mr. Goose"
          className="w-16 h-16 object-contain shrink-0 -mt-1"
        />

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-base font-bold text-primary tracking-wide">Mr. Goose</p>
            <p className="text-lg text-foreground leading-relaxed mt-1">{message}</p>
          </div>

          <div className="flex items-center gap-2">
            {showBack && onBack && (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
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
