import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { EventReaction } from "../../types";
import type { OnboardingDemoFlow } from "../../hooks/useOnboardingDemoFlow";

interface EventMatchStepProps {
  flow: OnboardingDemoFlow;
}

const REACTIONS: { value: EventReaction; labelKey: string }[] = [
  { value: "interested", labelKey: "onboardingDemo.eventMatch.reactions.interested" },
  { value: "maybe", labelKey: "onboardingDemo.eventMatch.reactions.maybe" },
  { value: "not_for_me", labelKey: "onboardingDemo.eventMatch.reactions.notForMe" },
];

function reactionButtonClass(reaction: EventReaction, active: boolean): string {
  if (!active) return "";
  switch (reaction) {
    case "interested":
      return "border-primary bg-primary/10 text-primary";
    case "maybe":
      return "border-warning bg-warning/10 text-warning";
    case "not_for_me":
      return "border-muted-foreground bg-muted text-muted-foreground";
  }
}

export function EventMatchStep({ flow }: EventMatchStepProps) {
  const { t } = useTranslation();
  const reactionCount = Object.keys(flow.state.reactions).length;

  return (
    <div className="space-y-6 w-full">
      <div className="space-y-2 text-center lg:text-left">
        <p className="text-[11px] tracking-wider uppercase text-muted-foreground font-medium">
          {t("onboardingDemo.eventMatch.eyebrow")}
        </p>
        <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
          {t("onboardingDemo.eventMatch.title")}
        </h1>
        <p className="text-base text-muted-foreground">
          {t("onboardingDemo.eventMatch.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("onboardingDemo.eventMatch.pickedStatus", { count: reactionCount })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {flow.matchedEvents.map((event) => {
          const currentReaction = flow.state.reactions[event.id];
          return (
            <div key={event.id} className="flex flex-col gap-2">
              <PreviewStyleEventCard
                event={event}
                data-event-id={event.id}
                selected={currentReaction === "interested"}
              />
              <div
                role="group"
                aria-label={t("onboardingDemo.eventMatch.reactionGroup", { title: event.title })}
                className="flex gap-1"
              >
                {REACTIONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    aria-pressed={currentReaction === r.value}
                    onClick={() => flow.setReaction(event.id, r.value)}
                    className={cn(
                      "flex-1 rounded-lg border px-1 py-1.5 text-[10px] sm:text-xs transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      currentReaction === r.value
                        ? reactionButtonClass(r.value, true)
                        : "border-border bg-background hover:bg-secondary"
                    )}
                  >
                    {t(r.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {reactionCount < 2 && (
        <div className="text-center">
          <Button type="button" variant="link" onClick={flow.continueWithoutPicks}>
            {t("onboardingDemo.actions.continueWithoutPicks")}
          </Button>
        </div>
      )}
    </div>
  );
}
