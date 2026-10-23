import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getOutreachLeads,
  updateOutreachLead,
  type OutreachLead,
  type OutreachLeadFilters,
  type OutreachLeadUpdate,
} from "@/features/admin/api/admin.api";
import { gmailComposeUrl } from "@/features/admin/components/outreach/gmailCompose";
import { LeadDetailsDialog } from "@/features/admin/components/outreach/LeadDetailsDialog";
import { AdminEmptyState } from "@/features/admin/components/shared/AdminEmptyState";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { AdminTableFilters } from "@/features/admin/components/shared/AdminTableFilters";
import { Stack } from "@/shared/layout";
import { queryKeys } from "@/shared/lib/queryKeys";
import { Button } from "@/shared/ui/button";
import { ExternalLink, Mail } from "lucide-react";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { TableCell, TableRow } from "@/shared/ui/table";
import outreach from "../../../../../backend/controlbox/outreach.json" with { type: "json" };

const LEAD_STATUSES = ["new", "contacted", "replied", "submitted", "not_interested", "dismissed"] as const;

/** Organizers the daily research run found at every school, with what to record and send each of them. */
export function AdminOutreachPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<OutreachLeadFilters>({ leadType: "", status: "new", school: "", search: "" });
  const [openLead, setOpenLead] = useState<OutreachLead | null>(null);
  const leads = useQuery({ queryKey: queryKeys.outreach.leads(page, filters), queryFn: () => getOutreachLeads(page, filters) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.outreach.all });
  const updateLead = useMutation({
    mutationFn: ({ id, update }: { id: string; update: OutreachLeadUpdate }) => updateOutreachLead(id, update),
    onSuccess: (lead) => { setOpenLead(current => (current?.id === lead.id ? lead : current)); void refresh(); },
  });
  const filter = (key: keyof OutreachLeadFilters) => (value: string) => {
    setFilters(current => ({ ...current, [key]: value === "all" ? "" : value }));
    setPage(1);
  };

  return (
    <Stack gap={5}>
      <AdminPageHeader icon={Mail} title={t("admin.outreach.title")} description={t("admin.outreach.description")} onBack={onBack} />
      <AdminTableFilters search={filters.search} onSearchChange={filter("search")} school={filters.school} onSchoolChange={filter("school")}>
        <Select value={filters.leadType || "all"} onValueChange={filter("leadType")}>
          <SelectTrigger aria-label={t("admin.outreach.leadType")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {Object.keys(outreach.lead_types).map(value => <SelectItem key={value} value={value}>{t(`admin.outreach.leadTypes.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status || "all"} onValueChange={filter("status")}>
          <SelectTrigger aria-label={t("admin.status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {LEAD_STATUSES.map(value => <SelectItem key={value} value={value}>{t(`admin.outreach.statuses.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </AdminTableFilters>
      {leads.isError ? <Button variant="outline" onClick={() => void leads.refetch()}>{t("common.tryAgain")}</Button>
        : !leads.isPending && leads.data?.items.length === 0 ? <AdminEmptyState icon={Mail} title={t("admin.outreach.emptyTitle")} description={t("admin.outreach.emptyDescription")} />
        : <AdminTable isLoading={leads.isPending} count={leads.data?.total ?? 0} label={t("admin.outreach.title")}
          pagination={{ currentPage: page, totalPages: leads.data?.total_pages ?? 1, onPageChange: setPage }}
          headers={[{ label: t("admin.outreach.event") }, { label: t("admin.outreach.organizer") }, { label: t("admin.status") }, { label: t("common.actions") }]}>
          {leads.data?.items.map(lead => <TableRow key={lead.id}>
            <TableCell>
              <ItemContent>
                <ItemTitle>{lead.event_name}</ItemTitle>
                <ItemDescription>
                  {[lead.school_name, lead.event_date && new Date(`${lead.event_date}T12:00:00`).toLocaleDateString(i18n.language)].filter(Boolean).join(" · ")}
                </ItemDescription>
              </ItemContent>
            </TableCell>
            <TableCell>
              <ItemContent>
                <ItemTitle>{lead.organization}</ItemTitle>
                <ItemDescription>{[lead.contact_name, lead.contact_role, lead.email].filter(Boolean).join(" · ")}</ItemDescription>
              </ItemContent>
            </TableCell>
            <TableCell>
              <Select value={lead.status} disabled={updateLead.isPending}
                onValueChange={value => updateLead.mutate({ id: lead.id, update: { status: value as OutreachLead["status"] } })}>
                <SelectTrigger aria-label={t("admin.status")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map(value => <SelectItem key={value} value={value}>{t(`admin.outreach.statuses.${value}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Stack direction="horizontal" gap={2}>
                <Button variant="outline" onClick={() => setOpenLead(lead)}>{t("admin.outreach.details")}</Button>
                <Button asChild variant="outline" size="icon-sm" aria-label={t("admin.outreach.openEmail")}>
                  <a href={gmailComposeUrl({ to: lead.email, subject: lead.email_subject, body: lead.email_body })} target="_blank" rel="noopener noreferrer"><Mail /></a>
                </Button>
                <Button asChild variant="ghost" size="icon-sm" aria-label={t("admin.outreach.openEvent")}>
                  <a href={lead.event_url} target="_blank" rel="noopener noreferrer"><ExternalLink /></a>
                </Button>
              </Stack>
            </TableCell>
          </TableRow>)}
        </AdminTable>}
      <LeadDetailsDialog lead={openLead} isSaving={updateLead.isPending} onClose={() => setOpenLead(null)}
        onSaveNotes={(lead, notes) => updateLead.mutate({ id: lead.id, update: { notes } })} />
    </Stack>
  );
}
