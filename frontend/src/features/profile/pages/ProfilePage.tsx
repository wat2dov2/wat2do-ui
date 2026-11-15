import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { logoutAPI } from "@/features/auth/api/auth.api";
import { FollowedClubsSection } from "@/features/profile/components/FollowedClubsSection";
import { ProfileEventSection } from "@/features/profile/components/ProfileEventSection";
import { ProfileTeamActions } from "@/features/profile/components/ProfileTeamActions";
import { SubmissionsSection } from "@/features/profile/components/SubmissionsSection";
import { useFollowedClubs } from "@/features/profile/hooks/useFollowedClubs";
import { useProfileEvents } from "@/features/profile/hooks/useProfileEvents";
import { SettingsTabs } from "@/features/settings";
import { QP } from "@/shared/constants/queryParams";
import { PROFILE_SETTINGS_SECTION_ID, ROUTES } from "@/shared/constants/routes";
import { Container, Section, Stack } from "@/shared/layout";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { Button } from "@/shared/ui/button";

/**
 * The visitor's own page: the events they saved, went to and are going to,
 * the clubs they follow, a way into every submission form, their settings,
 * and signing out, in that order.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const events = useProfileEvents();
  const followed = useFollowedClubs();
  useSettingsInView(!events.isPending && !followed.isPending);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logoutAPI();
    } catch (err) {
      console.error("Logout API call failed, clearing local state anyway:", err);
    }
    router.replace(ROUTES.EVENTS);
  };

  return (
    <Container size="md">
      <Stack gap={8}>
        <PageShellHeader route={ROUTES.PROFILE} actions={<ProfileTeamActions />} />
        <ProfileEventSection
          title={t("profile.events.saved")}
          empty={t("profile.events.savedEmpty")}
          rows={events.saved}
          isPending={events.isPending}
        />
        <ProfileEventSection
          title={t("profile.events.past")}
          empty={t("profile.events.pastEmpty")}
          rows={events.past}
          isPending={events.isPending}
        />
        <ProfileEventSection
          title={t("profile.events.upcoming")}
          empty={t("profile.events.upcomingEmpty")}
          rows={events.upcoming}
          isPending={events.isPending}
        />
        <FollowedClubsSection clubs={followed.clubs} isPending={followed.isPending} />
        <SubmissionsSection />
        <Section id={PROFILE_SETTINGS_SECTION_ID} title={t("profile.settings")}>
          <SettingsTabs />
        </Section>
        <Stack direction="horizontal">
          <Button type="button" variant="outline" disabled={isSigningOut} onClick={() => void handleSignOut()}>
            <LogOut />
            {t("modals.signOut.logOut")}
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}

/**
 * A link to one settings tab (`/profile?tab=notifications`) opens the profile
 * on its settings: once every list above them has loaded, followed clubs
 * included, so nothing moves them again, the settings scroll into view.
 */
function useSettingsInView(listsLoaded: boolean) {
  const searchParams = useSearchParams();
  // Only the address the page opened on counts, not a tab picked here later.
  const [openedOnSettings] = useState(() => searchParams.has(QP.TAB));
  const scrolled = useRef(false);
  useEffect(() => {
    if (!openedOnSettings || !listsLoaded || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(PROFILE_SETTINGS_SECTION_ID)?.scrollIntoView({ block: "start" });
  }, [listsLoaded, openedOnSettings]);
}
