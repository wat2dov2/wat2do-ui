import { useEffect } from "react";
import { PartyPopper } from "lucide-react";
import { Button } from "@/shared/ui/button";
import confetti from "canvas-confetti";

interface OnboardingDoneStepProps {
  onFinish: () => void;
}

export function OnboardingDoneStep({ onFinish }: OnboardingDoneStepProps) {
  useEffect(() => {
    const end = Date.now() + 1500;
    const root = getComputedStyle(document.documentElement);
    const colors = [
      root.getPropertyValue("--primary").trim() || "rgb(0, 82, 255)",
      root.getPropertyValue("--success").trim() || "rgb(34, 197, 94)",
      root.getPropertyValue("--warning").trim() || "rgb(245, 158, 11)",
      root.getPropertyValue("--accent").trim() || "rgb(236, 72, 153)",
    ];

    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  return (
    <div className="flex flex-col items-center text-center space-y-6 max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-success flex items-center justify-center">
        <PartyPopper className="size-8 text-success-foreground" strokeWidth={2.5} />
      </div>
      <h1 className="font-sans font-bold text-[28px] leading-tight text-foreground">
        You're all set! 🎉
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Your personalized campus feed is ready. Time to discover what's happening around you.
      </p>
      <Button type="button" onClick={onFinish} size="lg">
        Let's explore
      </Button>
    </div>
  );
}
