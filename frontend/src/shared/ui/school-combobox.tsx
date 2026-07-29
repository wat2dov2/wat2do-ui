import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchCombobox,
  type SearchComboboxVariant,
} from "@/shared/ui/search-combobox";
import { Highlighter } from "@/shared/ui/highlighter";
import {
  ALL_SCHOOLS,
  DEFAULT_SCHOOL,
} from "@/shared/constants/schools";
import {
  searchSchools,
  type SchoolSummary,
} from "@/shared/api/schools.api";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

interface SchoolComboboxProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  variant?: SearchComboboxVariant;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  triggerClassName?: string;
  showHighlight?: boolean;
  isAdmin?: boolean;
}

type SchoolOption = Pick<SchoolSummary, "slug" | "name">;

export function SchoolCombobox({
  value,
  onChange,
  id,
  placeholder,
  variant = "nav",
  align = "start",
  contentClassName,
  triggerClassName,
  showHighlight = true,
  isAdmin = false,
}: SchoolComboboxProps) {
  const { t } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();

  const displayValue = useMemo(() => {
    if (value === ALL_SCHOOLS) return t("schools.allSchools");
    if (value) return getSchoolName(value);
    if (placeholder) return placeholder;
    return getSchoolName(DEFAULT_SCHOOL);
  }, [getSchoolName, placeholder, t, value]);

  const allSchoolsOption = useMemo<SchoolOption>(
    () => ({
      slug: ALL_SCHOOLS,
      name: t("schools.allSchools"),
    }),
    [t],
  );

  const renderTriggerLabel =
    variant === "nav" && showHighlight
      ? (label: string) => (
          <Highlighter
            action="highlight"
            color="var(--primary)"
            className="block min-w-0 flex-1 truncate text-primary-foreground"
          >
            {label}
          </Highlighter>
        )
      : undefined;

  return (
    <SearchCombobox<SchoolOption>
      selectedKey={value}
      onSelect={(school) => onChange(school.slug)}
      fetcher={searchSchools}
      getKey={(school) => school.slug}
      getLabel={(school) => school.name}
      displayValue={displayValue}
      allOption={isAdmin ? allSchoolsOption : undefined}
      isPlaceholder={!value && Boolean(placeholder)}
      renderTriggerLabel={renderTriggerLabel}
      debounceMs={220}
      variant={variant}
      align={align}
      id={id}
      searchPlaceholder={t("schools.searchPlaceholder")}
      emptyLabel={t("schools.noSchoolFound")}
      loadingLabel={t("common.loading")}
      contentClassName={contentClassName}
      triggerClassName={triggerClassName}
      searchOnEmpty={isAdmin}
    />
  );
}
