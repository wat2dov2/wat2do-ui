import Image from "next/image";
import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import { AdminTable } from "@/features/admin/components/shared/AdminTable";
import { Stack } from "@/shared/layout";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";
import { includedSlides, slideThumbnails } from "@/features/admin/lib/instagramCarousel";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramRunsTableProps {
  batches: Batch[];
  onOpenRun: (batch: Batch) => void;
}

const VISIBLE_THUMBNAILS = 3;
const THUMBNAIL_SIZE = 36;

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
        { label: t("admin.instagramPublishing.columns.images") },
      ]}
    >
      {batches.map((batch) => {
        const ran = new Date(batch.created_at);
        const thumbnails = slideThumbnails(batch);
        const overflow = Math.max(thumbnails.length - VISIBLE_THUMBNAILS, 0);

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
            <TableCell>{includedSlides(batch).length}</TableCell>
            <TableCell>
              <Stack direction="horizontal" gap={2} align="center">
                {thumbnails.slice(0, VISIBLE_THUMBNAILS).map((url, index) => (
                  <Image
                    key={`${batch.id}-${index}`}
                    src={url}
                    alt=""
                    width={THUMBNAIL_SIZE}
                    height={THUMBNAIL_SIZE}
                    unoptimized
                    className="size-9 rounded-md object-cover"
                  />
                ))}
                {overflow > 0 ? (
                  <Badge variant="outline" size="sm">
                    +{overflow}
                  </Badge>
                ) : null}
              </Stack>
            </TableCell>
          </TableRow>
        );
      })}
    </AdminTable>
  );
}
