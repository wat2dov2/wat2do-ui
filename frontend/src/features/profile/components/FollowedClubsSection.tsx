import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { ChevronRight, Users } from "lucide-react";
import { ProfileListSection } from "@/features/profile/components/ProfileListSection";
import { clubPagePath, ROUTES } from "@/shared/constants/routes";
import type { Club } from "@/shared/types";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { ImageTile } from "@/shared/ui/tile";
import { nameInitial } from "@/shared/utils/string";

/** The clubs the visitor follows at this school, each a row that opens its page. */
export function FollowedClubsSection({ clubs, isPending }: { clubs: Club[]; isPending: boolean }) {
  const { t } = useTranslation();

  return (
    <ProfileListSection
      rows={clubs}
      isPending={isPending}
      empty={{ icon: Users, text: t("profile.clubs.empty"), action: { label: t("clubs.allClubs"), href: ROUTES.CLUBS } }}
      rowKey={(club) => club.id}
      renderRow={(club) => (
        <Item size="sm" asChild>
          <NextLink href={clubPagePath(club.id)}>
            <ItemMedia>
              <ImageTile
                src={club.logo_url ?? null}
                kind="logo"
                fallback={<span className="text-sm font-medium text-muted-foreground">{nameInitial(club.club_name)}</span>}
              />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{club.club_name}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </ItemActions>
          </NextLink>
        </Item>
      )}
    />
  );
}
