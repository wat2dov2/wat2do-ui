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

import type { IntegrationServerOption, IntegrationChannelOption } from "@/features/organization-panel/api/integrations.api";

interface DiscordConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: "connect" | "select";
  botAdded: boolean;
  selectedServerId: string;
  selectedChannelId: string;
  servers: IntegrationServerOption[];
  selectedChannels: IntegrationChannelOption[];
  onAddBot: () => void;
  onSelectServer: (id: string) => void;
  onSelectChannel: (id: string) => void;
  onActivate: () => void;
  saving: boolean;
  selectedClubId: number | null;
}

export function DiscordConnectModal({
  open,
  onOpenChange,
  step,
  botAdded,
  selectedServerId,
  selectedChannelId,
  servers,
  selectedChannels,
  onAddBot,
  onSelectServer,
  onSelectChannel,
  onActivate,
  saving,
  selectedClubId,
}: DiscordConnectModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-md">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t("integrations.connectDiscord")}</DialogTitle>
            <DialogDescription>
              {step === "connect"
                ? t("integrations.discordStep1Desc")
                : t("integrations.discordStep2Desc")}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          <FieldGroup>
            {step === "connect" ? (
              <>
                <Field>
                  <FieldLabel className="text-sm font-medium">
                    {t("integrations.step1AddBot")}
                  </FieldLabel>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("integrations.addBotDescription")}
                  </p>
                  <Button
                    className="w-full bg-primary hover:bg-primary-hover"
                    onMouseDown={onAddBot}
                    disabled={botAdded || saving || !selectedClubId}
                  >
                    {botAdded ? (
                      <>
                        <Check className="size-4 mr-2" />
                        {t("integrations.botAdded")}
                      </>
                    ) : (
                      <>
                        <ExternalLink className="size-4 mr-2" />
                        {t("integrations.addToDiscord")}
                      </>
                    )}
                  </Button>
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel className="text-sm font-medium">
                    {t("integrations.step2SelectChannel")}
                  </FieldLabel>
                </Field>

                <Field>
                  <FieldLabel className="text-sm text-muted-foreground">
                    {t("integrations.server")}
                  </FieldLabel>
                  <Select value={selectedServerId} onValueChange={onSelectServer}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("integrations.selectServer")} />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map((server) => (
                        <SelectItem key={server.id} value={server.id}>
                          {server.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {selectedServerId && (
                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.channel")}
                    </FieldLabel>
                    <Select
                      value={selectedChannelId}
                      onValueChange={onSelectChannel}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectChannel")} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedChannels.map((channel) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <div className="p-3 bg-secondary rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.autoPublishNote")}
                  </p>
                </div>
              </>
            )}

            <Field orientation="horizontal">
              <DialogClose asChild>
                <Button variant="secondary" type="button">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              {step === "select" && (
                <Button
                  onMouseDown={onActivate}
                  disabled={
                    !selectedServerId ||
                    !selectedChannelId ||
                    saving ||
                    !selectedClubId
                  }
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
