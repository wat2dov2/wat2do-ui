import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { TableCell, TableRow } from "@/shared/ui/table";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramRunsTableProps {
  batches: Batch[];
  onOpenRun: (batch: Batch) => void;
}

export function InstagramRunsTable({ batches, onOpenRun }: InstagramRunsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en-US";

  return (
    <AdminTable
      headers={[
        { label: t("admin.instagramPublishing.columns.school") },
        { label: t("admin.instagramPublishing.columns.dateRan") },
        { label: t("admin.instagramPublishing.columns.timeRan") },
        { label: t("admin.instagramPublishing.columns.events") },
      ]}
    >
      {batches.map((batch) => {
        const ran = new Date(batch.created_at);

        return (
          <TableRow
            key={batch.id}
            interactive
            role="button"
            tabIndex={0}
            aria-label={batch.account_key}
            onClick={() => onOpenRun(batch)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenRun(batch);
              }
            }}
          >
            <TableCell>{getSchoolDisplayName(batch.school)}</TableCell>
            <TableCell>{batch.local_date}</TableCell>
            <TableCell>
              {ran.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}
            </TableCell>
            <TableCell>{batch.items.length}</TableCell>
          </TableRow>
        );
      })}
    </AdminTable>
  );
}
