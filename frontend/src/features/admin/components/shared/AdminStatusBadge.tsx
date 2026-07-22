import { useTranslation } from "react-i18next";
import {
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import type { SubmissionStatus } from "@/shared/types";

interface AdminStatusBadgeProps {
  status: SubmissionStatus | "reported" | "live";
  label?: string;
}

export function AdminStatusBadge({ status, label }: AdminStatusBadgeProps) {
  const { t } = useTranslation();

  const statusConfig: Record<string, string> = {
    [SUBMISSION_APPROVED]: "bg-success/20 text-success",
    [SUBMISSION_REJECTED]: "bg-destructive/20 text-destructive",
    [SUBMISSION_PENDING]: "bg-warning/20 text-warning",
    reported: "bg-destructive/20 text-destructive",
    live: "text-muted-foreground",
  };

  const statusTranslations: Record<string, string> = {
    [SUBMISSION_APPROVED]: t("admin.approved"),
    [SUBMISSION_REJECTED]: t("admin.rejected"),
    [SUBMISSION_PENDING]: t("admin.pending"),
    reported: t("admin.reported"),
    live: t("common.live"),
  };

  const className = statusConfig[status] || statusConfig.live;
  const translatedLabel = label || statusTranslations[status] || status;

  if (status === "live") {
    return <span className={`text-xs uppercase ${className}`}>{translatedLabel}</span>;
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {translatedLabel}
    </span>
  );
}
