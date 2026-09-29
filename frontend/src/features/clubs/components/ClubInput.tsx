import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveClubByInstagramHandle } from "@/features/clubs/api/clubService";
import { getClubSocialHandle } from "@/features/clubs/utils/clubCardContent";
import type { Club } from "@/shared/types";
import { FormInput } from "@/shared/ui/form-field";

interface ClubInputProps {
  value: number | null;
  clubs: Club[];
  onChange: (clubId: number | null) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
}

/** Resolve an Instagram handle to the canonical club ID used by submissions. */
export function ClubInput({
  value,
  clubs,
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
  const inputValue = value !== draft.resolvedId
    ? selectedHandle
    : draft.handle || (value != null ? selectedHandle : "");

  return (
    <FormInput
      name="club_id"
      label={t("forms.instagramHandle")}
      required
      disabled={clubs.length === 0}
      value={inputValue}
      onChange={(nextValue) => {
        const handle = String(nextValue);
        const clubId = resolveClubByInstagramHandle(clubs, handle)?.id ?? null;
        setDraft({ handle, resolvedId: clubId });
        onChange(clubId);
      }}
      onBlur={onBlur}
      placeholder={t("modals.signIn.username")}
      error={inputValue && value == null ? t("clubs.noClubsFound") : error}
      touched={touched}
    />
  );
}
