import { useTranslation } from "react-i18next";
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
  nextLabel,
  nextDisabled = false,
  showBack = true,
}: GooseDialogueProps) {
  const { t } = useTranslation();
  const { displayed, done, skip } = useTypewriter(message);
  const resolvedNextLabel = nextLabel ?? t("common.continue");

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <img
          src={GOOSE_IMAGE_PATH}
          alt={t("onboarding.gooseName")}
          className="size-16 object-contain shrink-0 -mt-1"
        />

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <Badge variant="new" className="w-fit text-xs font-medium px-2 py-0.5 mb-2">{t("onboarding.gooseName")}</Badge>
            <p
              className="text-lg text-foreground leading-relaxed mt-1 cursor-pointer"
              role={!done ? "button" : undefined}
              tabIndex={!done ? 0 : undefined}
              onClick={!done ? skip : undefined}
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
          </div>

          <div className="flex items-center gap-2">
            {showBack && onBack && (
              <Button type="button" variant="secondary" size="sm" onClick={onBack}>
                {t("common.back")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={onNext}
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
