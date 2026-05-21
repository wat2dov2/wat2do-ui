import { useState } from "react";
import { m } from "framer-motion";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { FACULTY_OPTIONS } from "@/features/auth/hooks/useOnboardingFlow";
import { SPLASH_ANIMATION_MS } from "@/features/auth/constants";

const SELECT_PLACEHOLDER_VALUE = "__placeholder__";

/** Faculty-specific colors (from onboarding branch origin) — single color per faculty for blob splash */
const FACULTY_COLORS: Record<string, string> = {
  Arts: "var(--faculty-arts-splash)",
  Engineering: "var(--faculty-engineering-splash)",
  Environment: "var(--faculty-environment-splash)",
  Health: "var(--faculty-health-splash)",
  Mathematics: "var(--faculty-mathematics-splash)",
  Science: "var(--faculty-science-splash)",
  "Applied Health Sciences": "var(--faculty-applied-health-sciences-splash)",
};

function generateSplashPoints(faculty: string) {
  const color = FACULTY_COLORS[faculty] ?? "var(--faculty-science-splash)";
  const seed = `${faculty}-${Date.now()}`;
  return Array.from({ length: 20 }, (_, idx) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 200 + Math.random() * 300;
    const horizontalMultiplier =
      Math.abs(Math.cos(angle)) > 0.3 ? 1.8 : 0.6;
    return {
      id: `${seed}-${idx}`,
      angle,
      distance: distance * horizontalMultiplier,
      size: 40 + Math.random() * 80,
      borderRadius: 20 + Math.random() * 60,
      color,
    };
  });
}

interface OnboardingFacultyStepProps {
  faculty: string;
  onFacultyChange: (value: string) => void;
}

export function OnboardingFacultyStep({
  faculty,
  onFacultyChange,
}: OnboardingFacultyStepProps) {
  const { t } = useTranslation();
  const value = faculty || SELECT_PLACEHOLDER_VALUE;
  const [splash, setSplash] = useState(false);
  const [splashPoints, setSplashPoints] = useState<ReturnType<
    typeof generateSplashPoints
  >>([]);

  const handleValueChange = (v: string) => {
    const next = v === SELECT_PLACEHOLDER_VALUE ? "" : v;
    onFacultyChange(next);
    if (next && FACULTY_OPTIONS.includes(next as (typeof FACULTY_OPTIONS)[number])) {
      setSplashPoints(generateSplashPoints(next));
      setSplash(true);
      setTimeout(() => setSplash(false), SPLASH_ANIMATION_MS);
    }
  };

  return (
    <>
      {splash && (
        <div className="fixed inset-0 pointer-events-none z-easter-egg" aria-hidden>
          {splashPoints.map((point) => (
            <m.div
              key={point.id}
              className="absolute rounded-full left-1/2 top-[42%]"
              style={{
                width: point.size,
                height: point.size,
                borderRadius: `${point.borderRadius}%`,
                backgroundColor: point.color,
                marginLeft: -point.size / 2,
                marginTop: -point.size / 2,
              }}
              initial={{
                x: Math.cos(point.angle) * 20,
                y: Math.sin(point.angle) * 20,
                opacity: 1,
                scale: 0.5,
              }}
              animate={{
                x: Math.cos(point.angle) * point.distance,
                y: Math.sin(point.angle) * point.distance,
                opacity: 0,
                scale: 1,
              }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col items-center gap-y-4 max-w-sm mx-auto">
        <Select value={value} onValueChange={handleValueChange}>
          <SelectTrigger
            className={cn(
              "w-full",
              value === SELECT_PLACEHOLDER_VALUE && "text-muted-foreground"
            )}
          >
            <SelectValue placeholder={t("common.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value={SELECT_PLACEHOLDER_VALUE}
              className="text-muted-foreground"
            >
              {t("common.select")}
            </SelectItem>
            {FACULTY_OPTIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
