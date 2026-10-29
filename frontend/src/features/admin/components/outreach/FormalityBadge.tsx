import { useTranslation } from "react-i18next";
import type { OutreachLead } from "@/features/admin/api/admin.api";
import { Badge } from "@/shared/ui/badge";

/** How official a club looks, out of 100: established clubs read as success, informal ones as a warning. */
export function FormalityBadge({ formality }: { formality: OutreachLead["formality"] }) {
  const { t } = useTranslation();
  if (formality === null) return <Badge variant="muted">{t("admin.outreach.notScored")}</Badge>;
  const variant = formality >= 70 ? "success" : formality >= 40 ? "secondary" : "warning";
  return <Badge variant={variant}>{t("admin.outreach.formalityScore", { value: formality })}</Badge>;
}
