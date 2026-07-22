import { useTranslation } from "react-i18next";
import { m } from "framer-motion";
import { Badge } from "@/shared/ui/badge";
import { DemoSplitLayout } from "../DemoSplitLayout";

const PRO_BENEFIT_KEYS = [
  "onboardingDemo.proUnlock.benefits.save",
  "onboardingDemo.proUnlock.benefits.follow",
  "onboardingDemo.proUnlock.benefits.alerts",
  "onboardingDemo.proUnlock.benefits.calendar",
  "onboardingDemo.proUnlock.benefits.food",
  "onboardingDemo.proUnlock.benefits.profile",
];

export function ProUnlockStep() {
  const { t } = useTranslation();

  return (
    <DemoSplitLayout
      left={
        <m.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-6"
        >
          <Badge className="bg-primary text-primary-foreground">
            {t("onboardingDemo.proUnlock.badge")}
          </Badge>
          <div className="space-y-2">
            <h1 className="font-sans font-semibold text-3xl sm:text-4xl text-foreground leading-tight">
              {t("onboardingDemo.proUnlock.title")}
            </h1>
            <p className="text-base text-muted-foreground">
              {t("onboardingDemo.proUnlock.description")}
            </p>
          </div>
          <ul className="space-y-2">
            {PRO_BENEFIT_KEYS.map((benefitKey) => (
              <li key={benefitKey} className="flex items-center gap-2 text-sm text-foreground">
                <span className="size-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                {t(benefitKey)}
              </li>
            ))}
          </ul>
        </m.div>
      }
      right={
        <m.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl bg-primary p-8 min-h-[280px] flex flex-col items-center justify-center relative overflow-hidden"
        >
          <div className="absolute inset-0 opacity-20" aria-hidden>
            <div className="absolute top-8 left-8 size-24 rounded-full border-2 border-white/40" />
            <div className="absolute bottom-12 right-12 size-32 rounded-full border-2 border-white/30" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-40 rounded-full border border-white/20" />
          </div>
          <div className="relative text-center space-y-3">
            <p className="text-white/80 text-sm font-medium">
              {t("onboardingDemo.proUnlock.brand")}
            </p>
            <p className="text-white text-2xl sm:text-3xl font-semibold">
              {t("onboardingDemo.proUnlock.visualTitle")}
            </p>
            <p className="text-white/70 text-sm max-w-xs">
              {t("onboardingDemo.proUnlock.visualDescription")}
            </p>
          </div>
        </m.div>
      }
    />
  );
}
