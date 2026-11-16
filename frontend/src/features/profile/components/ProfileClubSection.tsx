import { ProfileListSection, ProfileRow, type ProfileListEmpty, type ProfileRowTarget } from "@/features/profile/components/ProfileListSection";
import type { Club } from "@/shared/types";
import { ImageTile } from "@/shared/ui/tile";
import { nameInitial } from "@/shared/utils/string";

interface ProfileClubSectionProps {
  title: string;
  clubs: Club[];
  isPending: boolean;
  empty: ProfileListEmpty;
  /** What a club's row opens. */
  target: (club: Club) => ProfileRowTarget;
}

/** One of the profile's club lists: each club's logo and name. */
export function ProfileClubSection({ title, clubs, isPending, empty, target }: ProfileClubSectionProps) {
  return (
    <ProfileListSection
      title={title}
      rows={clubs}
      isPending={isPending}
      empty={empty}
      rowKey={(club) => club.id}
      renderRow={(club) => (
        <ProfileRow
          media={
            <ImageTile
              src={club.logo_url ?? null}
              kind="logo"
              fallback={<span className="text-sm font-medium text-muted-foreground">{nameInitial(club.club_name)}</span>}
            />
          }
          title={club.club_name}
          target={target(club)}
        />
      )}
    />
  );
}
