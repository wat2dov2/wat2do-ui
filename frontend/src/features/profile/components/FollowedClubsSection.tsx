import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { ProfileRowsSkeleton } from "@/features/profile/components/ProfileEventSection";
import { clubPagePath } from "@/shared/constants/routes";
import { Section, Stack } from "@/shared/layout";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import type { Club } from "@/shared/types";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/shared/ui/item";

/** The clubs the visitor follows at this school, each linked to its page. */
export function FollowedClubsSection({ clubs, isPending }: { clubs: Club[]; isPending: boolean }) {
  const { t } = useTranslation();

  return (
    <Section
      title={t("profile.clubs.title")}
      description={!isPending && clubs.length === 0 ? t("profile.clubs.empty") : undefined}
    >
      {isPending ? (
        <ProfileRowsSkeleton />
      ) : clubs.length ? (
        <Stack gap={2}>
          {clubs.map((club) => (
            <Item key={club.id} variant="outline" size="sm" asChild>
              <NextLink href={clubPagePath(club.id)}>
                <ItemMedia>
                  <AvatarStack decorative avatars={[{ src: club.logo_url ?? "", name: club.club_name }]} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{club.club_name}</ItemTitle>
                </ItemContent>
              </NextLink>
            </Item>
          ))}
        </Stack>
      ) : null}
    </Section>
  );
}
