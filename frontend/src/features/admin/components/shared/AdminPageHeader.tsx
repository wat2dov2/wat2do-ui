import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/layout";
import { useTranslation } from "react-i18next";

interface AdminPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onBack?: () => void;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
}

export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  onBack,
  action,
}: AdminPageHeaderProps) {
  const { t } = useTranslation();

  return (
    <PageHeader
      icon={Icon}
      title={title}
      description={description}
      back={
        onBack
          ? {
              label: t("admin.backToDashboard"),
              onClick: onBack,
            }
          : undefined
      }
      actions={
        action ? (
          <Button size="sm" onClick={action.onClick}>
            {action.icon && <action.icon />}
            {action.label}
          </Button>
        ) : undefined
      }
    />
  );
}
