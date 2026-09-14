import { useTranslation } from "react-i18next";
import {
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
} from "@/shared/constants/statuses";
import type { SubmissionStatus } from "@/shared/types";
import { Badge } from "@/shared/ui/badge";
import type { ComponentProps } from "react";

interface AdminStatusBadgeProps {
  status: SubmissionStatus;
  label?: string;
}

export function AdminStatusBadge({ status, label }: AdminStatusBadgeProps) {
  const { t } = useTranslation();

  const statusConfig: Record<AdminStatusBadgeProps["status"], ComponentProps<typeof Badge>["variant"]> = {
    [SUBMISSION_APPROVED]: "success",
    [SUBMISSION_REJECTED]: "destructive",
    [SUBMISSION_PENDING]: "warning",
  };

  const statusTranslations: Record<string, string> = {
    [SUBMISSION_APPROVED]: t("admin.approved"),
    [SUBMISSION_REJECTED]: t("admin.rejected"),
    [SUBMISSION_PENDING]: t("admin.pending"),
  };

  const translatedLabel = label || statusTranslations[status] || status;
  return <Badge variant={statusConfig[status]} size="lg">{translatedLabel}</Badge>;
}
