/**
 * Admin Status Badge Component
 * Reusable status badge with consistent styling
 */

import React from "react";
import { useTranslation } from "react-i18next";

interface AdminStatusBadgeProps {
  status: "pending" | "approved" | "rejected" | "reported" | "live";
  label?: string;
}

export function AdminStatusBadge({ status, label }: AdminStatusBadgeProps) {
  const { t } = useTranslation();
  
  const statusConfig = {
    approved: "bg-success/20 text-success",
    rejected: "bg-error/20 text-error",
    pending: "bg-warning/20 text-warning",
    reported: "bg-error/20 text-error",
    live: "text-muted-foreground",
  };

  const statusTranslations = {
    approved: t("admin.approved"),
    rejected: t("admin.rejected"),
    pending: t("admin.pending"),
    reported: t("admin.reported"),
    live: t("common.live"),
  };

  const className = statusConfig[status] || statusConfig.live;
  const translatedLabel = label || statusTranslations[status] || status;

  if (status === "live") {
    return <span className={`text-xs ${className}`}>{translatedLabel}</span>;
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
      {translatedLabel}
    </span>
  );
}
