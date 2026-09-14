import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { GOOSE_IMAGE_PATH } from "../constants";
import { useTypewriter } from "@/shared/hooks/useTypewriter";

interface GooseDialogueProps {
  message: string;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  showBack?: boolean;
}

export function GooseDialogue({
  message,
  onBack,
  onNext,
  nextLabel,
  showBack = true,
}: GooseDialogueProps) {
  const { t } = useTranslation();
  const { displayed, done, skip } = useTypewriter(message);
  const resolvedNextLabel = nextLabel ?? t("common.continue");

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <img
          src={GOOSE_IMAGE_PATH}
          alt={t("onboarding.gooseName")}
          className="size-12 object-contain shrink-0"
        />

        <p
          className="text-left text-lg text-foreground leading-relaxed cursor-pointer"
          role={!done ? "button" : undefined}
          tabIndex={!done ? 0 : undefined}
          onMouseDown={!done ? skip : undefined}
          onKeyDown={
            !done
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    skip();
                  }
                }
              : undefined
          }
        >
          {displayed}
          {!done && <span className="inline-block w-[2px] h-[1em] bg-foreground align-text-bottom ml-px animate-pulse" />}
        </p>

        <div className="flex items-center gap-2">
          {showBack && onBack && (
            <Button type="button" variant="outline" size="sm" onMouseDown={onBack}>
              {t("common.back")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onMouseDown={onNext}
          >
            {resolvedNextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
