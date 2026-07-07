import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { GOOSE_IMAGE_PATH } from "../constants";
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
  nextLabel,
  nextDisabled = false,
  showBack = true,
}: GooseDialogueProps) {
  const { t } = useTranslation();
  const { displayed, done, skip } = useTypewriter(message);
  const resolvedNextLabel = nextLabel ?? t("common.continue");

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:gap-4">
        <img
          src={GOOSE_IMAGE_PATH}
          alt={t("onboarding.gooseName")}
          className="size-16 object-contain shrink-0 sm:-mt-1"
        />

        <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
          <Badge variant="new" className="w-fit text-xs font-medium px-2 py-0.5">{t("onboarding.gooseName")}</Badge>
          <p
            className="w-full text-left text-lg text-foreground leading-relaxed cursor-pointer"
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

          <div className="flex w-full items-center gap-2">
            {showBack && onBack && (
              <Button type="button" variant="secondary" size="sm" onMouseDown={onBack}>
                {t("common.back")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onMouseDown={onNext}
              disabled={nextDisabled}
            >
              {resolvedNextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
