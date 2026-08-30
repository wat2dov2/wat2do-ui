import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchCombobox,
  type SearchComboboxVariant,
} from "@/shared/ui/search-combobox";
import { Highlighter } from "@/shared/ui/highlighter";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import type { SchoolSummary } from "@/shared/api/schools.api";
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
}

type SchoolOption = Pick<SchoolSummary, "slug" | "name" | "email_domains">;

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
}: SchoolComboboxProps) {
  const { t } = useTranslation();
  const { schools, getSchoolName } = useSchoolDirectory();

  const displayValue = useMemo(() => {
    if (value) return getSchoolName(value);
    if (placeholder) return placeholder;
    return getSchoolName(DEFAULT_SCHOOL);
  }, [getSchoolName, placeholder, value]);

  // The school's own pair, not the app's: this is the one place in the nav that
  // names where you are, so it is marked in that school's colour and inked in
  // the colour that school pairs with it.
  const renderTriggerLabel =
    variant === "nav" && showHighlight
      ? (label: string) => (
          <Highlighter
            action="highlight"
            color="var(--school-marker)"
            className="block min-w-0 flex-1 truncate font-bold text-school-marker-foreground"
          >
            {label}
          </Highlighter>
        )
      : undefined;

  return (
    <SearchCombobox<SchoolOption>
      selectedKey={value}
      onSelect={(school) => onChange(school.slug)}
      items={schools}
      getKey={(school) => school.slug}
      getLabel={(school) => school.name}
      getSearchTerms={(school) => [
        school.name,
        school.slug,
        ...(school.email_domains ?? []),
      ]}
      displayValue={displayValue}
      isPlaceholder={!value && Boolean(placeholder)}
      renderTriggerLabel={renderTriggerLabel}
      variant={variant}
      align={align}
      id={id}
      searchPlaceholder={t("schools.searchPlaceholder")}
      emptyLabel={t("schools.noSchoolFound")}
      contentClassName={contentClassName}
      triggerClassName={triggerClassName}
    />
  );
}
