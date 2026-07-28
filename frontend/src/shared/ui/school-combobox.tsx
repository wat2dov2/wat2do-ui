import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchCombobox,
  type SearchComboboxVariant,
} from "@/shared/ui/search-combobox";
import { Highlighter } from "@/shared/ui/highlighter";
import { ALL_SCHOOLS, DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { translateSchool } from "@/shared/utils/schoolTranslation";
import { searchSchools } from "@/shared/api/schools.api";

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

  const displayValue = useMemo(() => {
    if (value) return translateSchool(value);
    if (placeholder) return placeholder;
    return translateSchool(DEFAULT_SCHOOL);
  }, [placeholder, value]);

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
    <SearchCombobox<string>
      selectedKey={value}
      onSelect={onChange}
      fetcher={searchSchools}
      getKey={(school) => school}
      getLabel={(school) => translateSchool(school)}
      displayValue={displayValue}
      allOption={isAdmin ? ALL_SCHOOLS : undefined}
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
