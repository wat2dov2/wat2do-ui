import { useCallback } from "react";
import { QP } from "@/shared/constants/queryParams";
import { PROFILE_TABS, SETTINGS_TABS, type ProfileTab } from "@/shared/constants/routes";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";

const PROFILE_TAB_VALUES = Object.values(PROFILE_TABS);
const SETTINGS_TAB_VALUES: readonly string[] = Object.values(SETTINGS_TABS);

/**
 * The profile's open tab, kept in the address (`/profile?tab=clubs`) so a
 * link can open any of them. A settings tab's name (`?tab=notifications`, as
 * the emails link it) opens Settings with that tab selected.
 */
export function useProfileTab() {
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const requested = searchParams.get(QP.TAB) ?? "";
  const tab: ProfileTab = SETTINGS_TAB_VALUES.includes(requested)
    ? PROFILE_TABS.SETTINGS
    : (PROFILE_TAB_VALUES.find((value) => value === requested) ?? PROFILE_TABS.EVENTS);
  const selectTab = useCallback(
    (next: string) => setSearchParams(next === PROFILE_TABS.EVENTS ? {} : { [QP.TAB]: next }),
    [setSearchParams],
  );
  return { tab, selectTab };
}
