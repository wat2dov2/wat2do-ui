import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Organization } from "@/shared/types";
import { FormInput } from "@/shared/ui/form-field";

interface OrganizationInputProps {
  value: number | null;
  organizations: Organization[];
  onChange: (organizationId: number | null) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
}

/**
 * Plain organization-name input for the event form.
 *
 * The API continues to use organization_id as its source of truth. This component
 * keeps the typed display name local and resolves an exact, case-insensitive match
 * from the active school's organizations before updating that canonical ID.
 */
export function OrganizationInput({
  value,
  organizations,
  onChange,
  onBlur,
  error,
  touched,
}: OrganizationInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    name: "",
    resolvedId: value,
  });

  const selectedOrganizationName = useMemo(
    () =>
      value == null
        ? ""
        : organizations.find((organization) => organization.id === value)
            ?.organization_name ?? "",
    [organizations, value],
  );

  const inputValue =
    value !== draft.resolvedId
      ? selectedOrganizationName
      : draft.name || (value != null ? selectedOrganizationName : "");

  return (
    <FormInput
      name="organization_id"
      label={t("events.organization")}
      required
      value={inputValue}
      onChange={(nextValue) => {
        const organizationName = String(nextValue).trim().toLocaleLowerCase();
        const organizationId =
          organizations.find(
            (organization) =>
              organization.organization_name.trim().toLocaleLowerCase() ===
              organizationName,
          )?.id ?? null;

        setDraft({
          name: String(nextValue),
          resolvedId: organizationId,
        });
        onChange(organizationId);
      }}
      onBlur={onBlur}
      placeholder={t("forms.organizationNamePlaceholder")}
      error={error}
      touched={touched}
    />
  );
}
