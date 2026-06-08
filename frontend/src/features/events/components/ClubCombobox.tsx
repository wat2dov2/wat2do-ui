import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Club } from "@/shared/types";
import { filterOrganizations } from "@/features/organizations";
import { SearchCombobox } from "@/shared/ui/search-combobox";

interface ClubComboboxProps {
  value: number | null;
  clubs: Club[];
  onChange: (clubId: number) => void;
  onBlur?: () => void;
  id?: string;
  hasError?: boolean;
}

/**
 * Required club picker for the event form. Reuses the shared SearchCombobox
 * and the clubs feature's client-side filter over a list provided by the form
 * (loaded once and shared with the live preview).
 */
export function ClubCombobox({ value, clubs, onChange, onBlur, id, hasError }: ClubComboboxProps) {
  const { t } = useTranslation();

  const fetcher = useCallback(
    (query: string) => filterOrganizations(clubs, { searchQuery: query }),
    [clubs],
  );

  const displayValue = useMemo(() => {
    const selected = value != null ? clubs.find((club) => club.id === value) : undefined;
    return selected?.club_name ?? t("forms.selectClub");
  }, [clubs, value, t]);

  return (
    <SearchCombobox<Club>
      selectedKey={value != null ? String(value) : ""}
      onSelect={(club) => {
        onChange(club.id);
        onBlur?.();
      }}
      fetcher={fetcher}
      getKey={(club) => String(club.id)}
      getLabel={(club) => club.club_name}
      displayValue={displayValue}
      isPlaceholder={value == null}
      searchOnEmpty
      variant="field"
      id={id}
      searchPlaceholder={t("forms.searchClubPlaceholder")}
      emptyLabel={t("forms.noClubFound")}
      loadingLabel={t("common.loading")}
      triggerClassName={
        hasError ? "ring-2 ring-destructive/50 bg-destructive/10" : undefined
      }
    />
  );
}
