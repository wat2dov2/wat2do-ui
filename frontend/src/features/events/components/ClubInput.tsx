import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

/**
 * Plain club-name input for the event form.
 *
 * The API continues to use club_id as its source of truth. This component
 * keeps the typed name or Instagram handle local and resolves an exact, case-insensitive match
 * from the active school's clubs before updating that canonical ID.
 */
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
    name: "",
    resolvedId: value,
  });

  const selectedClubName = useMemo(
    () =>
      value == null
        ? ""
        : clubs.find((club) => club.id === value)
            ?.club_name ?? "",
    [clubs, value],
  );

  const inputValue =
    value !== draft.resolvedId
      ? selectedClubName
      : draft.name || (value != null ? selectedClubName : "");

  return (
    <FormInput
      name="club_id"
      label={t("events.club")}
      required
      value={inputValue}
      onChange={(nextValue) => {
        const clubName = String(nextValue).trim().toLocaleLowerCase();
        const instagramHandle = clubName.replace(/^@/, "");
        const clubId =
          clubs.find(
            (club) =>
              club.club_name.trim().toLocaleLowerCase() ===
              clubName ||
              (Boolean(instagramHandle) && club.ig?.trim().replace(/^@/, "").toLocaleLowerCase() === instagramHandle),
          )?.id ?? null;

        setDraft({
          name: String(nextValue),
          resolvedId: clubId,
        });
        onChange(clubId);
      }}
      onBlur={onBlur}
      placeholder={t("forms.clubNamePlaceholder")}
      error={error}
      touched={touched}
    />
  );
}
