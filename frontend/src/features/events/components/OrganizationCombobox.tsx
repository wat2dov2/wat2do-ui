import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Organization } from "@/shared/types";
import { filterOrganizations } from "@/features/organizations";
import { SearchCombobox } from "@/shared/ui/search-combobox";

interface OrganizationComboboxProps {
  value: number | null;
  organizations: Organization[];
  onChange: (organizationId: number) => void;
  onBlur?: () => void;
  id?: string;
  hasError?: boolean;
}

/**
 * Required organization picker for the event form. Reuses the shared SearchCombobox
 * and the organizations feature's client-side filter over a list provided by the form
 * (loaded once and shared with the live preview).
 */
export function OrganizationCombobox({
  value,
  organizations,
  onChange,
  onBlur,
  id,
  hasError,
}: OrganizationComboboxProps) {
  const { t } = useTranslation();

  const fetcher = useCallback(
    (query: string) => filterOrganizations(organizations, { searchQuery: query }),
    [organizations],
  );

  const displayValue = useMemo(() => {
    const selected = value != null ? organizations.find((org) => org.id === value) : undefined;
    return selected?.club_name ?? t("forms.selectOrganization");
  }, [organizations, value, t]);

  return (
    <SearchCombobox<Organization>
      selectedKey={value != null ? String(value) : ""}
      onSelect={(org) => {
        onChange(org.id);
        onBlur?.();
      }}
      fetcher={fetcher}
      getKey={(org) => String(org.id)}
      getLabel={(org) => org.club_name}
      displayValue={displayValue}
      isPlaceholder={value == null}
      searchOnEmpty
      variant="field"
      id={id}
      searchPlaceholder={t("forms.searchOrganizationPlaceholder")}
      emptyLabel={t("forms.noOrganizationFound")}
      loadingLabel={t("common.loading")}
      triggerClassName={
        hasError ? "ring-2 ring-destructive/50 bg-destructive/10" : undefined
      }
    />
  );
}
