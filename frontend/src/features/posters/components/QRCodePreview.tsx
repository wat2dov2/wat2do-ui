import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Check } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";

interface QRCodePreviewProps {
  qrUrl: string;
  name: string;
  onDownload?: () => void;
  onDone?: () => void;
  downloadLabel?: string;
  doneLabel?: string;
  successMessage?: string;
  className?: string;
}

export function QRCodePreview({
  qrUrl,
  name,
  onDownload,
  onDone,
  downloadLabel,
  doneLabel,
  successMessage,
  className = "",
}: QRCodePreviewProps) {
  const { t } = useTranslation();
  return (
    <div className={`space-y-6 ${className}`}>
      {successMessage && (
        <div className="flex items-center gap-2 text-success">
          <Check className="size-5" />
          <span className="font-medium">{successMessage}</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-4 p-6 border border-border rounded-xl bg-secondary/50">
        <div className="p-4 bg-background rounded-lg border border-border">
          <QRCodeSVG value={qrUrl} size={256} />
        </div>
        <div className="text-center">
          <p className="font-medium text-sm mb-1">{name}</p>
          <p className="text-xs text-muted-foreground break-all">{qrUrl}</p>
        </div>
      </div>

      {(onDownload || onDone) && (
        <div className="flex gap-2 justify-end">
          {onDone && (
            <Button variant="secondary" onMouseDown={onDone}>
              {doneLabel || t("common.done")}
            </Button>
          )}
          {onDownload && (
            <Button onMouseDown={onDownload}>
              {downloadLabel || t("common.download")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
