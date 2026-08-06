import i18n from "@/shared/lib/i18n";
import en0 from "@/shared/locales/en.json";
import en1 from "@/features/auth/locales/en.json";
import en2 from "@/features/events/locales/en.json";
import en3 from "@/features/organizations/locales/en.json";
import en4 from "@/features/organization-panel/locales/en.json";
import en5 from "@/features/admin/locales/en.json";
import en6 from "@/features/credits/locales/en.json";
import en7 from "@/features/qrcode/locales/en.json";
import en8 from "@/features/settings/locales/en.json";
import en9 from "@/features/onboarding-demo/locales/en.json";
import en10 from "@/features/posters/locales/en.json";

/**
 * Register English before anything renders.
 *
 * Every locale is otherwise a dynamic import, and the app withholds its ready
 * flag until they all arrive. Each page therefore painted the server's content,
 * then re-rendered against unseeded state once the chunks landed - the flash of
 * skeletons between two identical screens.
 *
 * English is the default for nearly every visitor, so it is imported rather than
 * fetched: `loadLanguage("en")` finds the bundle already registered and returns
 * without a round trip, making ready true on the first tick. Other languages
 * stay dynamic. This lives in `app/` because only the composition root may reach
 * into features.
 */
const ENGLISH_TRANSLATIONS: Record<string, unknown> = Object.assign(
  {},
  en0, en1, en2, en3, en4, en5, en6, en7, en8, en9, en10,
);

i18n.addResourceBundle("en", "translation", ENGLISH_TRANSLATIONS);
