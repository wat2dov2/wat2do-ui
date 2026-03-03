import { Users, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ONBOARDING_EVENT_CARDS } from "@/features/auth/hooks/useOnboardingFlow";
import { availableCategories } from "@/features/events/data/events";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LightRays } from "@/shared/ui/light-rays";

interface OnboardingTopicsStepProps {
  selectedTopics: string[];
  onToggleTopic: (category: string) => void;
}

export function OnboardingTopicsStep({
  selectedTopics,
  onToggleTopic,
}: OnboardingTopicsStepProps) {
  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 w-full max-w-3xl">
        {availableCategories.map((category) => {
          const card = ONBOARDING_EVENT_CARDS[category];
          if (!card) return null;

          const isSelected = selectedTopics.includes(category);
          const catClasses = getCategoryClasses(category);

          return (
            <div key={category} className={cn(
              "rounded-2xl p-1 transition-all duration-300",
              isSelected ? "border-2 border-primary" : "border-2 border-transparent",
            )}>
            <button
              type="button"
              onClick={() => onToggleTopic(category)}
              className={cn(
                "rounded-xl overflow-hidden text-left transition-all duration-300 flex flex-col bg-card cursor-pointer w-full",
                !isSelected && "hover:shadow-lg hover:opacity-80",
              )}
            >
              {/* Image */}
              <div className="relative overflow-hidden" style={{ height: 140 }}>
                <LazyImage
                  src={card.image}
                  alt={card.title}
                  className="absolute inset-0 w-full h-full"
                  fallback={
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 flex items-center justify-center">
                      <ImageOff className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                  }
                  placeholder={
                    <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 animate-pulse" />
                  }
                />

                {/* Category badge — top left */}
                <BadgeMask variant="top-left">
                  <span
                    className={cn(
                      "font-bold text-[10px] px-2 py-0.5 block rounded-full",
                      catClasses.bg,
                      catClasses.text
                    )}
                  >
                    {translateCategory(category, (k) => k.split(".").pop() ?? k)}
                  </span>
                </BadgeMask>

                {/* Org badge — bottom left */}
                <BadgeMask variant="bottom-left">
                  <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
                    <Users className="w-3 h-3" strokeWidth={2} />
                    <span className="truncate max-w-[80px]">{card.org}</span>
                  </span>
                </BadgeMask>

              </div>

              {/* Content */}
              <div className="relative flex flex-col flex-1 px-4 pt-3 pb-2.5 border-l border-r border-b border-border rounded-b-xl">
                <LightRays />
                <h3 className="font-bold text-sm leading-tight line-clamp-2 text-foreground">
                  {card.title}
                </h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {category}
                </p>
              </div>
            </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}
