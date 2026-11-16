import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveClubByInstagramHandle, suggestClubsByHandle } from "@/features/clubs/api/clubService";
import { getClubSocialHandle } from "@/features/clubs/utils/clubCardContent";
import type { Club } from "@/shared/types";
import { FormInput } from "@/shared/ui/form-field";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { ImageTile } from "@/shared/ui/tile";
import { nameInitial } from "@/shared/utils/string";

/** How many matching clubs the handle field's dropdown lists at once. */
const MAX_SUGGESTIONS = 8;

interface ClubInputProps {
  value: number | null;
  clubs: Club[];
  /** Shows the one club the form is for, which cannot be changed (a club owner's own club). */
  locked?: boolean;
  onChange: (clubId: number | null) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
}

/**
 * Resolve an Instagram handle to the canonical club ID used by submissions.
 * As a handle is typed, the school's clubs whose handle or name matches are
 * offered in a dropdown, and picking one fills in its handle.
 */
export function ClubInput({
  value,
  clubs,
  locked = false,
  onChange,
  onBlur,
  error,
  touched,
}: ClubInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    handle: "",
    resolvedId: value,
  });

  const selectedClub = clubs.find(club => club.id === value);
  const selectedHandle = selectedClub ? getClubSocialHandle(selectedClub) ?? "" : "";
  const inputValue = locked
    ? selectedHandle || (selectedClub?.club_name ?? "")
    : value !== draft.resolvedId
      ? selectedHandle
      : draft.handle || (value != null ? selectedHandle : "");

  // Matching waits for typing to settle, so a big directory never slows the keystrokes.
  const typed = useDeferredValue(inputValue);
  const suggestions = useMemo(
    () => (locked ? [] : suggestClubsByHandle(clubs, typed, MAX_SUGGESTIONS)),
    [clubs, locked, typed],
  );

  const enterHandle = (handle: string) => {
    const clubId = resolveClubByInstagramHandle(clubs, handle)?.id ?? null;
    setDraft({ handle, resolvedId: clubId });
    onChange(clubId);
  };

  const pickClub = (clubId: number) => {
    const club = clubs.find(item => item.id === clubId);
    if (!club) return;
    setDraft({ handle: getClubSocialHandle(club) ?? "", resolvedId: club.id });
    onChange(club.id);
  };

  return (
    <FormInput
      name="club_id"
      label={t("forms.instagramHandle")}
      required
      disabled={locked || clubs.length === 0}
      value={inputValue}
      onChange={nextValue => enterHandle(String(nextValue))}
      onBlur={onBlur}
      placeholder={t("modals.signIn.username")}
      error={!locked && inputValue && value == null ? t("clubs.noClubsFound") : error}
      touched={touched}
      suggestions={{
        label: t("forms.instagramHandle"),
        onSelect: clubId => pickClub(Number(clubId)),
        items: suggestions.map(club => ({
          key: club.id,
          content: (
            <>
              <ImageTile
                src={club.logo_url ?? null}
                kind="logo"
                fallback={<span className="text-sm font-medium text-muted-foreground">{nameInitial(club.club_name)}</span>}
              />
              <ItemContent>
                <ItemTitle>{getClubSocialHandle(club)}</ItemTitle>
                <ItemDescription>{club.club_name}</ItemDescription>
              </ItemContent>
            </>
          ),
        })),
      }}
    />
  );
}
