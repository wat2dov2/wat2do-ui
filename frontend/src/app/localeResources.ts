import i18n from "@/shared/lib/i18n";
import sharedEn from "@/shared/locales/en.json";
import sharedZh from "@/shared/locales/zh.json";
import authEn from "@/features/auth/locales/en.json";
import authZh from "@/features/auth/locales/zh.json";
import eventsEn from "@/features/events/locales/en.json";
import eventsZh from "@/features/events/locales/zh.json";
import organizationsEn from "@/features/organizations/locales/en.json";
import organizationsZh from "@/features/organizations/locales/zh.json";
import organizationPanelEn from "@/features/organization-panel/locales/en.json";
import organizationPanelZh from "@/features/organization-panel/locales/zh.json";
import adminEn from "@/features/admin/locales/en.json";
import adminZh from "@/features/admin/locales/zh.json";
import creditsEn from "@/features/credits/locales/en.json";
import creditsZh from "@/features/credits/locales/zh.json";
import qrcodeEn from "@/features/qrcode/locales/en.json";
import qrcodeZh from "@/features/qrcode/locales/zh.json";
import settingsEn from "@/features/settings/locales/en.json";
import settingsZh from "@/features/settings/locales/zh.json";
import onboardingDemoEn from "@/features/onboarding-demo/locales/en.json";
import onboardingDemoZh from "@/features/onboarding-demo/locales/zh.json";

const localeResources = {
  en: {
    ...sharedEn,
    ...authEn,
    ...eventsEn,
    ...organizationsEn,
    ...organizationPanelEn,
    ...adminEn,
    ...creditsEn,
    ...qrcodeEn,
    ...settingsEn,
    ...onboardingDemoEn,
  },
  zh: {
    ...sharedZh,
    ...authZh,
    ...eventsZh,
    ...organizationsZh,
    ...organizationPanelZh,
    ...adminZh,
    ...creditsZh,
    ...qrcodeZh,
    ...settingsZh,
    ...onboardingDemoZh,
  },
};

export function installBundledLocales() {
  Object.entries(localeResources).forEach(([lang, resources]) => {
    if (!i18n.hasResourceBundle(lang, "translation")) {
      i18n.addResourceBundle(lang, "translation", resources);
    }
  });
}
