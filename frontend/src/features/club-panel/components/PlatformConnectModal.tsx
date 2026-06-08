import React from "react";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogClose,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ModalContentWrapper, ModalHeaderWrapper } from "@/shared/ui/modal-components";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";
import type { IntegrationServerOption } from "@/features/club-panel/api/integrations.api";

export interface PlatformConnectConfig {
  /** Dialog title translation key, e.g. "integrations.connectTelegram" */
  titleKey: string;
  /** Step 1 description translation key */
  step1DescKey: string;
  /** Step 2 description translation key */
  step2DescKey: string;
  /** Connect step label translation key */
  connectLabelKey: string;
  /** Connect step description translation key */
  connectDescKey: string;
  /** Authorize button text (already authorized) translation key */
  authorizedTextKey: string;
  /** Authorize button text (not yet authorized) translation key */
  authorizeTextKey: string;
  /** Brand color classes for the authorize button, e.g. "bg-sky-600 hover:bg-sky-700" */
  brandColorClass: string;
  /** Select step header label translation key */
  selectLabelKey: string;
  /** Primary select field label translation key */
  primaryFieldLabelKey: string;
  /** Primary select placeholder translation key */
  primaryPlaceholderKey: string;
  /** Auto-publish note translation key */
  noteKey: string;
}

export interface PlatformConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: "connect" | "select";
  authorized: boolean;
  selectedPrimaryId: string;
  servers: IntegrationServerOption[];
  onAuthorize: () => void;
  onSelectPrimary: (id: string) => void;
  onActivate: () => void;
  config: PlatformConnectConfig;
  /** Optional extra content rendered between the select step header and the primary select field. */
  extraSelectContent?: React.ReactNode;
  /** Override which servers to show in the select dropdown. Defaults to `servers`. */
  filteredServers?: IntegrationServerOption[];
  /** Override the primary select field label. */
  primaryFieldLabelOverride?: string;
  /** Override the primary select placeholder. */
  primaryPlaceholderOverride?: string;
  /** Override the auto-publish note text. */
  noteOverride?: string;
  /** Override the activate button disabled state. Defaults to `!selectedPrimaryId`. */
  activateDisabled?: boolean;
}

export function PlatformConnectModal({
  open,
  onOpenChange,
  step,
  authorized,
  selectedPrimaryId,
  servers,
  onAuthorize,
  onSelectPrimary,
  onActivate,
  config,
  extraSelectContent,
  filteredServers,
  primaryFieldLabelOverride,
  primaryPlaceholderOverride,
  noteOverride,
  activateDisabled,
}: PlatformConnectModalProps) {
  const { t } = useTranslation();

  const displayServers = filteredServers ?? servers;
  const primaryLabel = primaryFieldLabelOverride ?? t(config.primaryFieldLabelKey);
  const primaryPlaceholder = primaryPlaceholderOverride ?? t(config.primaryPlaceholderKey);
  const noteText = noteOverride ?? t(config.noteKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-md">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t(config.titleKey)}</DialogTitle>
            <DialogDescription>
              {step === "connect"
                ? t(config.step1DescKey)
                : t(config.step2DescKey)}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          <FieldGroup>
            {step === "connect" ? (
              <>
                <Field>
                  <FieldLabel className="text-sm font-medium">
                    {t(config.connectLabelKey)}
                  </FieldLabel>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t(config.connectDescKey)}
                  </p>
                  <Button
                    className={`w-full ${config.brandColorClass}`}
                    onClick={onAuthorize}
                    disabled={authorized}
                  >
                    {authorized ? (
                      <>
                        <Check className="size-4 mr-2" />
                        {t(config.authorizedTextKey)}
                      </>
                    ) : (
                      <>
                        <ExternalLink className="size-4 mr-2" />
                        {t(config.authorizeTextKey)}
                      </>
                    )}
                  </Button>
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel className="text-sm font-medium">
                    {t(config.selectLabelKey)}
                  </FieldLabel>
                </Field>

                {extraSelectContent}

                <Field>
                  <FieldLabel className="text-sm text-muted-foreground">
                    {primaryLabel}
                  </FieldLabel>
                  <Select value={selectedPrimaryId} onValueChange={onSelectPrimary}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={primaryPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {displayServers.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="p-3 bg-secondary rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {noteText}
                  </p>
                </div>
              </>
            )}

            <Field orientation="horizontal">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              {step === "select" && (
                <Button
                  onClick={onActivate}
                  disabled={activateDisabled ?? !selectedPrimaryId}
                >
                  {t("integrations.activate")}
                </Button>
              )}
            </Field>
          </FieldGroup>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}
