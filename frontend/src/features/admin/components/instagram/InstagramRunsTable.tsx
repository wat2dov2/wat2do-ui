import Image from "next/image";
import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";
import { includedSlides, slideThumbnails } from "@/features/admin/lib/instagramCarousel";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramRunsTableProps {
  batches: Batch[];
  onOpenRun: (batch: Batch) => void;
}

const VISIBLE_THUMBNAILS = 3;

export function InstagramRunsTable({ batches, onOpenRun }: InstagramRunsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en-US";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.instagramPublishing.columns.school")}</TableHead>
          <TableHead>{t("admin.instagramPublishing.columns.dateRan")}</TableHead>
          <TableHead>{t("admin.instagramPublishing.columns.timeRan")}</TableHead>
          <TableHead>{t("admin.instagramPublishing.columns.events")}</TableHead>
          <TableHead>{t("admin.instagramPublishing.columns.images")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => {
          const ran = new Date(batch.created_at);
          const thumbnails = slideThumbnails(batch);
          const overflow = Math.max(thumbnails.length - VISIBLE_THUMBNAILS, 0);

          return (
            <TableRow
              key={batch.id}
              role="button"
              tabIndex={0}
              aria-label={batch.account_key}
              className="cursor-pointer"
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
                <div className="flex items-center gap-2">
                  {thumbnails.slice(0, VISIBLE_THUMBNAILS).map((url, index) => (
                    <Image
                      key={`${batch.id}-${index}`}
                      src={url}
                      alt=""
                      width={36}
                      height={45}
                      unoptimized
                      className="size-9 rounded-md bg-muted object-cover"
                    />
                  ))}
                  {overflow > 0 ? <Badge variant="outline" size="sm">+{overflow}</Badge> : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
