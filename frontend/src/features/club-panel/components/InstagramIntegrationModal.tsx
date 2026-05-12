import React from "react";
import { useTranslation } from "react-i18next";
import { AtSign } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogClose,
} from "@/shared/ui/dialog";
import { ModalContentWrapper, ModalHeaderWrapper } from "@/shared/ui/modal-components";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";

interface InstagramIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handle: string;
  onHandleChange: (handle: string) => void;
  onConnect: () => void;
}

export function InstagramIntegrationModal({
  open,
  onOpenChange,
  handle,
  onHandleChange,
  onConnect,
}: InstagramIntegrationModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-md">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t("integrations.connectInstagram")}</DialogTitle>
            <DialogDescription>
              {t("integrations.instagramModalDesc")}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          <FieldGroup>
            <Field>
              <FieldLabel className="text-sm font-medium">
                {t("integrations.instagramHandle")}
              </FieldLabel>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={handle}
                  onChange={(e) => onHandleChange(e.target.value)}
                  placeholder={t("integrations.instagramHandlePlaceholder")}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("integrations.instagramHandleHelp")}
              </p>
            </Field>

            <div className="p-3 bg-secondary rounded-lg">
              <p className="text-sm text-muted-foreground">
                {t("integrations.instagramAutoImportNote")}
              </p>
            </div>

            <Field orientation="horizontal">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button
                onClick={onConnect}
                disabled={!handle}
              >
                {t("integrations.connect")}
              </Button>
            </Field>
          </FieldGroup>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}
