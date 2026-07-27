import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ChevronDown, Download } from "@/shared/ui/doodle-icons";
import { LoadingButton } from "@/shared/ui/loading-button";

interface PosterDownloadMenuProps {
  onDownload: (format: "pdf" | "png") => void;
  isLoading: boolean;
  disabled?: boolean;
  size?: "default" | "sm";
  variant?: "primary" | "secondary";
  testId: string;
}

export function PosterDownloadMenu({
  onDownload,
  isLoading,
  disabled = false,
  size = "default",
  variant = "primary",
  testId,
}: PosterDownloadMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <LoadingButton
          type="button"
          variant={variant}
          size={size}
          isLoading={isLoading}
          disabled={disabled}
          data-testid={testId}
        >
          <Download />
          {t("posters.download")}
          <ChevronDown />
        </LoadingButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => onDownload("pdf")}
          data-testid={`${testId}-pdf`}
        >
          {t("posters.downloadPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onDownload("png")}
          data-testid={`${testId}-png`}
        >
          {t("posters.downloadPng")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
