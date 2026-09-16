import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";

interface AdminSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  onClear?: () => void;
  submitLabel?: string;
  clearLabel?: string;
}

export function AdminSearchBar({
  value,
  onChange,
  placeholder,
  onSubmit,
  onClear,
  submitLabel,
  clearLabel,
}: AdminSearchBarProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ applied: value, text: value });
  if (draft.applied !== value) {
    setDraft({ applied: value, text: value });
  }

  return (
    <SubmittedSearchInput
      value={onSubmit ? value : draft.text}
      onChange={onSubmit ? onChange : text => setDraft({ applied: value, text })}
      onSubmit={onSubmit ?? (() => onChange(draft.text.trim()))}
      onClear={onClear ?? (() => {
        setDraft({ applied: "", text: "" });
        onChange("");
      })}
      placeholder={placeholder}
      submitLabel={submitLabel ?? t("common.search")}
      clearLabel={clearLabel ?? t("common.clearFilters")}
    />
  );
}
