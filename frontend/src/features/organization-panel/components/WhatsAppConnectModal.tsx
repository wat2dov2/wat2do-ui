import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/shared/ui/doodle-icons";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogClose,
} from "@/shared/ui/dialog";
import { ModalContentWrapper, ModalHeaderWrapper } from "@/shared/ui/modal-components";
import { Field, FieldGroup } from "@/shared/ui/field";
import { WHATSAPP_BOT_URL } from "@/features/organization-panel/constants";

interface WhatsAppConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function WhatsAppConnectModal({
  open,
  onOpenChange,
  onDone,
}: WhatsAppConnectModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-md">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t("integrations.connectWhatsApp")}</DialogTitle>
            <DialogDescription>
              {t("integrations.whatsAppModalDesc")}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          <FieldGroup>
            <div className="flex flex-col items-center py-4">
              <div className="p-4 bg-background rounded-lg border border-border mb-4">
                <QRCodeSVG
                  value={WHATSAPP_BOT_URL}
                  size={160}
                  level="M"
                />
              </div>
              <p className="text-sm text-muted-foreground text-center mb-4">
                {t("common.or")}
              </p>
              <Button variant="outline" className="w-full" asChild>
                <a
                  href={WHATSAPP_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-4 mr-2" />
                  {t("integrations.openInWhatsApp")}
                </a>
              </Button>
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {t("integrations.whatsAppInstructions")}
              </p>
            </div>

            <Field orientation="horizontal">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button onMouseDown={onDone}>
                {t("common.done")}
              </Button>
            </Field>
          </FieldGroup>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}
