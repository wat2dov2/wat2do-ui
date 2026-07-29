import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { Badge } from "@/shared/ui/badge";
import { TableCell, TableRow } from "@/shared/ui/table";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramRunsTableProps {
  batches: Batch[];
  onOpenRun: (batch: Batch) => void;
}

function statusBadgeVariant(status: Batch["status"]) {
  switch (status) {
    case "published":
      return "success" as const;
    case "failed":
      return "destructive" as const;
    case "generating":
    case "publishing":
      return "warning" as const;
    case "empty":
      return "muted" as const;
    case "ready_for_review":
      return "secondary" as const;
  }
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
        { label: t("admin.instagramPublishing.columns.status") },
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
            <TableCell>{batch.school}</TableCell>
            <TableCell>{batch.local_date}</TableCell>
            <TableCell>
              {ran.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}
            </TableCell>
            <TableCell>{batch.items.length}</TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariant(batch.status)}>
                {t(`admin.instagramPublishing.status.${batch.status}`)}
              </Badge>
            </TableCell>
          </TableRow>
        );
      })}
    </AdminTable>
  );
}
