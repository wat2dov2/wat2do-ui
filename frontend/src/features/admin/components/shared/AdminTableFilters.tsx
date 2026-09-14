import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { AdminSearchBar } from "./AdminSearchBar";

interface AdminTableFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  school: string;
  onSchoolChange: (value: string) => void;
  children?: ReactNode;
}

export function AdminTableFilters({ search, onSearchChange, school, onSchoolChange, children }: AdminTableFiltersProps) {
  const { t } = useTranslation();
  const { schools } = useSchoolDirectory();
  return (
    <Stack direction="horizontal" gap={3}>
      <AdminSearchBar value={search} onChange={onSearchChange} placeholder={t("common.search")} />
      <Select value={school || "all"} onValueChange={value => onSchoolChange(value === "all" ? "" : value)}>
        <SelectTrigger size="lg" aria-label={t("schools.school")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("common.all")}</SelectItem>
          {schools.map(item => <SelectItem key={item.slug} value={item.slug}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {children}
    </Stack>
  );
}
