import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Bookmark, CalendarCheck, History, LogOut } from "lucide-react";
import { logoutAPI } from "@/features/auth/api/auth.api";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { SavedPositionsGrid, useSavedPositions } from "@/features/positions";
import { FollowedClubsSection } from "@/features/profile/components/FollowedClubsSection";
import { ProfileEventSection } from "@/features/profile/components/ProfileEventSection";
import { ProfileAvatarSkeleton, ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { ProfileRowsSkeleton } from "@/features/profile/components/ProfileListSection";
import { ProfileTeamActions } from "@/features/profile/components/ProfileTeamActions";
import { SubmissionsSection } from "@/features/profile/components/SubmissionsSection";
import { useFollowedClubs } from "@/features/profile/hooks/useFollowedClubs";
import { useProfileEvents } from "@/features/profile/hooks/useProfileEvents";
import { useProfileTab } from "@/features/profile/hooks/useProfileTab";
import { AvatarPicker, SettingsTabs, useSettingsForm } from "@/features/settings";
import { PROFILE_TABS, ROUTES } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ItemGroup } from "@/shared/ui/item";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsListSkeleton, TabsTrigger } from "@/shared/ui/tabs";

/** The profile's tabs, in order; the page and its loading state share the count. */
const TAB_ORDER = [
  PROFILE_TABS.EVENTS,
  PROFILE_TABS.CLUBS,
  PROFILE_TABS.POSITIONS,
  PROFILE_TABS.SUBMISSIONS,
  PROFILE_TABS.SETTINGS,
] as const;

const TAB_LABEL_KEYS = {
  [PROFILE_TABS.EVENTS]: "navigation.events",
  [PROFILE_TABS.CLUBS]: "navigation.clubs",
  [PROFILE_TABS.POSITIONS]: "navigation.positions",
  [PROFILE_TABS.SUBMISSIONS]: "profile.tabs.submissions",
  [PROFILE_TABS.SETTINGS]: "profile.settings",
} as const;

/**
 * The visitor's own page: who they are, then one tab each for their events,
 * the clubs they follow, the positions they saved, the ways to submit
 * something, and their settings.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { userEmail, userFullName, school } = useAuthState();
  const { getSchoolName } = useSchoolDirectory();
  const { tab, selectTab } = useProfileTab();
  const events = useProfileEvents();
  const followed = useFollowedClubs();
  const savedPositions = useSavedPositions();
  const settings = useSettingsForm();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const email = userEmail ?? "";

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logoutAPI();
    } catch (err) {
      console.error("Logout API call failed, clearing local state anyway:", err);
    }
    router.replace(ROUTES.EVENTS);
  };

  const counts: Partial<Record<(typeof TAB_ORDER)[number], number>> = {
    [PROFILE_TABS.CLUBS]: followed.isPending ? undefined : followed.clubs.length,
    [PROFILE_TABS.POSITIONS]: savedPositions.isPending ? undefined : savedPositions.positions.length,
  };

  return (
    <Container size="md">
      <Stack gap={8}>
        <ProfileHeader
          avatar={
            <AvatarPicker
              avatarUrl={settings.avatarPreviewUrl ?? settings.values.profile.avatarUrl}
              initial={(email[0] ?? "?").toUpperCase()}
              isLoading={settings.isProfileLoading}
              disabled={settings.isSaving}
              onAvatarChange={settings.selectAvatar}
            />
          }
          identity={{
            name: userFullName || email.split("@")[0],
            email,
            schoolName: school ? getSchoolName(school) : null,
          }}
          actions={<ProfileTeamActions />}
          signOut={
            <Button type="button" variant="outline" size="sm" disabled={isSigningOut} onClick={() => void handleSignOut()}>
              <LogOut />
              {t("modals.signOut.logOut")}
            </Button>
          }
        />
        <Tabs value={tab} onValueChange={selectTab}>
          <Stack gap={6}>
            <TabsList aria-label={t("navigation.profile")}>
              {TAB_ORDER.map((value) => (
                <TabsTrigger key={value} value={value} count={counts[value]}>
                  {t(TAB_LABEL_KEYS[value])}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={PROFILE_TABS.EVENTS}>
              <Stack gap={12}>
                <ProfileEventSection
                  title={t("profile.events.upcoming")}
                  empty={{ icon: CalendarCheck, text: t("profile.events.upcomingEmpty"), action: { label: t("events.allEvents"), href: ROUTES.EVENTS } }}
                  rows={events.upcoming}
                  isPending={events.isPending}
                />
                <ProfileEventSection
                  title={t("profile.events.saved")}
                  empty={{ icon: Bookmark, text: t("profile.events.savedEmpty"), action: { label: t("events.allEvents"), href: ROUTES.EVENTS } }}
                  rows={events.saved}
                  isPending={events.isPending}
                />
                <ProfileEventSection
                  title={t("profile.events.past")}
                  empty={{ icon: History, text: t("profile.events.pastEmpty"), action: { label: t("events.allEvents"), href: ROUTES.EVENTS } }}
                  rows={events.past}
                  isPending={events.isPending}
                />
              </Stack>
            </TabsContent>
            <TabsContent value={PROFILE_TABS.CLUBS}>
              <FollowedClubsSection clubs={followed.clubs} isPending={followed.isPending} />
            </TabsContent>
            <TabsContent value={PROFILE_TABS.POSITIONS}>
              <SavedPositionsGrid positions={savedPositions.positions} isPending={savedPositions.isPending} />
            </TabsContent>
            <TabsContent value={PROFILE_TABS.SUBMISSIONS}>
              <SubmissionsSection />
            </TabsContent>
            <TabsContent value={PROFILE_TABS.SETTINGS}>
              <SettingsTabs settings={settings} />
            </TabsContent>
          </Stack>
        </Tabs>
      </Stack>
    </Container>
  );
}

/** The profile while the session is read: the same header, tab row and first list, in place. */
export function ProfilePageLoading() {
  const { t } = useTranslation();
  return (
    <Container size="md">
      <Stack gap={8}>
        <ProfileHeader
          avatar={<ProfileAvatarSkeleton />}
          identity={null}
          actions={null}
          signOut={<Skeleton className="h-8 w-24 rounded-xl" />}
        />
        <Stack gap={6}>
          <TabsListSkeleton count={TAB_ORDER.length} />
          <Section title={t("profile.events.upcoming")}>
            <ItemGroup>
              <ProfileRowsSkeleton />
            </ItemGroup>
          </Section>
        </Stack>
      </Stack>
    </Container>
  );
}
