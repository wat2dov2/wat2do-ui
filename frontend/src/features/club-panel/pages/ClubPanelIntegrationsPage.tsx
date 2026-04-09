import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Link, MessageCircle, Check, ExternalLink, AtSign } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/constants/routes";
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
import { DiscordIcon, InstagramIcon, SlackIcon, TelegramIcon, LinkedInIcon, FacebookIcon } from "@/shared/ui/platform-icons";
import { WHATSAPP_BOT_URL } from "@/shared/constants/externalUrls";
import { useIntegrations } from "@/features/club-panel/hooks/useIntegrations";
import { IntegrationCard } from "@/features/club-panel/components/IntegrationCard";

export function ClubPanelIntegrationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const integrations = useIntegrations();

  const actionDisabled = integrations.loading || integrations.saving || !integrations.selectedClubId;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => navigate(ROUTES.CLUB_PANEL)}
          className="shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Link className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("clubPanel.integrations")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("integrations.pageDescription")}
          </p>
        </div>
      </div>

      {/* Club selector */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <FieldLabel className="text-sm text-muted-foreground">
          Active club for integrations
        </FieldLabel>
        <Select
          value={integrations.selectedClubId ? String(integrations.selectedClubId) : ""}
          onValueChange={(value) => integrations.setSelectedClubId(Number(value))}
          disabled={integrations.loading || integrations.clubs.length === 0}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue placeholder={integrations.clubs.length === 0 ? "No clubs found" : "Select club"} />
          </SelectTrigger>
          <SelectContent>
            {integrations.clubs.map((club) => (
              <SelectItem key={club.id} value={String(club.id)}>
                {club.club_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {integrations.error && <p className="text-xs text-error">{integrations.error}</p>}
      </div>

      {/* Integration Cards */}
      <div className="space-y-4">
        <IntegrationCard
          integration={integrations.getIntegration("whatsapp")}
          platform="whatsapp"
          icon={<MessageCircle className="w-6 h-6 text-green-600" />}
          iconBgClassName="bg-green-100"
          titleKey="clubPanel.whatsapp"
          descriptionKey="integrations.whatsappScrapeDesc"
          onConnect={() => integrations.handleConnect("whatsapp")}
          onDisconnect={() => integrations.handleDisconnect("whatsapp")}
        />

        <IntegrationCard
          integration={integrations.getIntegration("discord")}
          platform="discord"
          icon={<DiscordIcon className="w-6 h-6 text-indigo-600" />}
          iconBgClassName="bg-indigo-100"
          titleKey="clubPanel.discord"
          descriptionKey="integrations.discordScrapeDesc"
          onConnect={() => integrations.handleConnect("discord")}
          onDisconnect={() => integrations.handleDisconnect("discord")}
          disabled={actionDisabled}
        />

        <IntegrationCard
          integration={integrations.getIntegration("instagram")}
          platform="instagram"
          icon={<InstagramIcon className="w-6 h-6 text-pink-600" />}
          iconBgClassName="bg-linear-to-br from-purple-100 to-pink-100"
          titleKey="integrations.instagram"
          descriptionKey="integrations.instagramScrapeDesc"
          onConnect={() => integrations.handleConnect("instagram")}
          onDisconnect={() => integrations.handleDisconnect("instagram")}
        />

        <IntegrationCard
          integration={integrations.getIntegration("slack")}
          platform="slack"
          icon={<SlackIcon className="w-6 h-6 text-purple-600" />}
          iconBgClassName="bg-purple-100"
          titleKey="integrations.slack"
          descriptionKey="integrations.slackScrapeDesc"
          onConnect={() => integrations.handleConnect("slack")}
          onDisconnect={() => integrations.handleDisconnect("slack")}
        />

        <IntegrationCard
          integration={integrations.getIntegration("telegram")}
          platform="telegram"
          icon={<TelegramIcon className="w-6 h-6 text-sky-600" />}
          iconBgClassName="bg-sky-100"
          titleKey="integrations.telegram"
          descriptionKey="integrations.telegramScrapeDesc"
          onConnect={() => integrations.handleConnect("telegram")}
          onDisconnect={() => integrations.handleDisconnect("telegram")}
        />

        <IntegrationCard
          integration={integrations.getIntegration("linkedin")}
          platform="linkedin"
          icon={<LinkedInIcon className="w-6 h-6 text-blue-700" />}
          iconBgClassName="bg-blue-100"
          titleKey="integrations.linkedin"
          descriptionKey="integrations.linkedinScrapeDesc"
          onConnect={() => integrations.handleConnect("linkedin")}
          onDisconnect={() => integrations.handleDisconnect("linkedin")}
        />

        <IntegrationCard
          integration={integrations.getIntegration("facebook")}
          platform="facebook"
          icon={<FacebookIcon className="w-6 h-6 text-blue-600" />}
          iconBgClassName="bg-blue-100"
          titleKey="integrations.facebook"
          descriptionKey="integrations.facebookScrapeDesc"
          onConnect={() => integrations.handleConnect("facebook")}
          onDisconnect={() => integrations.handleDisconnect("facebook")}
        />
      </div>

      {/* Discord Connection Modal */}
      <Dialog open={integrations.discordModalOpen} onOpenChange={integrations.setDiscordModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectDiscord")}</DialogTitle>
              <DialogDescription>
                {integrations.discordStep === "connect"
                  ? t("integrations.discordStep1Desc")
                  : t("integrations.discordStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {integrations.discordStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddBot")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addBotDescription")}
                    </p>
                    <Button
                      className="w-full bg-indigo-600 hover:bg-indigo-700"
                      onClick={integrations.handleAddToDiscord}
                      disabled={integrations.botAdded || integrations.saving || !integrations.selectedClubId}
                    >
                      {integrations.botAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.botAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
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
                    <Select value={integrations.selectedServerId} onValueChange={integrations.setSelectedServerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectServer")} />
                      </SelectTrigger>
                      <SelectContent>
                        {integrations.discordServers.map((server) => (
                          <SelectItem key={server.id} value={server.id}>
                            {server.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {integrations.selectedServerId && (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.channel")}
                      </FieldLabel>
                      <Select
                        value={integrations.selectedChannelId}
                        onValueChange={integrations.setSelectedChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {integrations.discordServers
                            .find((server) => server.id === integrations.selectedServerId)
                            ?.channels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>
                              {channel.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.autoPublishNote")}
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
                {integrations.discordStep === "select" && (
                  <Button
                    onClick={integrations.handleActivateDiscord}
                    disabled={
                      !integrations.selectedServerId ||
                      !integrations.selectedChannelId ||
                      integrations.saving ||
                      !integrations.selectedClubId
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

      {/* WhatsApp Connection Modal */}
      <Dialog open={integrations.whatsappModalOpen} onOpenChange={integrations.setWhatsappModalOpen}>
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
                    <ExternalLink className="w-4 h-4 mr-2" />
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
                <Button onClick={integrations.handleWhatsAppDone}>
                  {t("common.done")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Instagram Connection Modal */}
      <Dialog open={integrations.instagramModalOpen} onOpenChange={integrations.setInstagramModalOpen}>
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
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={integrations.instagramHandle}
                    onChange={(e) => integrations.setInstagramHandle(e.target.value)}
                    placeholder={t("integrations.instagramHandlePlaceholder")}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("integrations.instagramHandleHelp")}
                </p>
              </Field>

              <div className="p-3 bg-muted rounded-lg">
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
                  onClick={integrations.handleInstagramConnect}
                  disabled={!integrations.instagramHandle}
                >
                  {t("integrations.connect")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Slack Connection Modal */}
      <Dialog open={integrations.slackModalOpen} onOpenChange={integrations.setSlackModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectSlack")}</DialogTitle>
              <DialogDescription>
                {integrations.slackStep === "connect"
                  ? t("integrations.slackStep1Desc")
                  : t("integrations.slackStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {integrations.slackStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddApp")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addSlackAppDescription")}
                    </p>
                    <Button
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      onClick={integrations.handleAddToSlack}
                      disabled={integrations.slackAppAdded}
                    >
                      {integrations.slackAppAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.appAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.addToSlack")}
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
                      {t("integrations.workspace")}
                    </FieldLabel>
                    <Select value={integrations.selectedWorkspaceId} onValueChange={integrations.setSelectedWorkspaceId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectWorkspace")} />
                      </SelectTrigger>
                      <SelectContent>
                        {integrations.slackServers.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {integrations.selectedWorkspaceId && (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.channel")}
                      </FieldLabel>
                      <Select
                        value={integrations.selectedSlackChannelId}
                        onValueChange={integrations.setSelectedSlackChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {integrations.slackServers
                            .find((workspace) => workspace.id === integrations.selectedWorkspaceId)
                            ?.channels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>
                              {channel.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.slackAutoPublishNote")}
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
                {integrations.slackStep === "select" && (
                  <Button
                    onClick={integrations.handleActivateSlack}
                    disabled={!integrations.selectedWorkspaceId || !integrations.selectedSlackChannelId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Telegram Connection Modal */}
      <Dialog open={integrations.telegramModalOpen} onOpenChange={integrations.setTelegramModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectTelegram")}</DialogTitle>
              <DialogDescription>
                {integrations.telegramStep === "connect"
                  ? t("integrations.telegramStep1Desc")
                  : t("integrations.telegramStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {integrations.telegramStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1AddBot")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.addTelegramBotDescription")}
                    </p>
                    <Button
                      className="w-full bg-sky-600 hover:bg-sky-700"
                      onClick={integrations.handleAddTelegramBot}
                      disabled={integrations.telegramBotAdded}
                    >
                      {integrations.telegramBotAdded ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.botAdded")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.addTelegramBot")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectGroup")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.group")}
                    </FieldLabel>
                    <Select value={integrations.selectedTelegramGroupId} onValueChange={integrations.setSelectedTelegramGroupId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectGroup")} />
                      </SelectTrigger>
                      <SelectContent>
                        {integrations.telegramServers.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.telegramAutoPublishNote")}
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
                {integrations.telegramStep === "select" && (
                  <Button
                    onClick={integrations.handleActivateTelegram}
                    disabled={!integrations.selectedTelegramGroupId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* LinkedIn Connection Modal */}
      <Dialog open={integrations.linkedinModalOpen} onOpenChange={integrations.setLinkedinModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectLinkedIn")}</DialogTitle>
              <DialogDescription>
                {integrations.linkedinStep === "connect"
                  ? t("integrations.linkedinStep1Desc")
                  : t("integrations.linkedinStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {integrations.linkedinStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1ConnectAccount")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.linkedinConnectDescription")}
                    </p>
                    <Button
                      className="w-full bg-blue-700 hover:bg-blue-800"
                      onClick={integrations.handleLinkedinAuth}
                      disabled={integrations.linkedinConnected}
                    >
                      {integrations.linkedinConnected ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.accountConnected")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.connectWithLinkedIn")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectPage")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.companyPage")}
                    </FieldLabel>
                    <Select value={integrations.selectedLinkedinPageId} onValueChange={integrations.setSelectedLinkedinPageId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectPage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {integrations.linkedinServers.map((page) => (
                          <SelectItem key={page.id} value={page.id}>
                            {page.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.linkedinAutoPublishNote")}
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
                {integrations.linkedinStep === "select" && (
                  <Button
                    onClick={integrations.handleActivateLinkedin}
                    disabled={!integrations.selectedLinkedinPageId}
                  >
                    {t("integrations.activate")}
                  </Button>
                )}
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Facebook Connection Modal */}
      <Dialog open={integrations.facebookModalOpen} onOpenChange={integrations.setFacebookModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectFacebook")}</DialogTitle>
              <DialogDescription>
                {integrations.facebookStep === "connect"
                  ? t("integrations.facebookStep1Desc")
                  : t("integrations.facebookStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {integrations.facebookStep === "connect" ? (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step1ConnectAccount")}
                    </FieldLabel>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("integrations.facebookConnectDescription")}
                    </p>
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={integrations.handleFacebookAuth}
                      disabled={integrations.facebookConnected}
                    >
                      {integrations.facebookConnected ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {t("integrations.accountConnected")}
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("integrations.connectWithFacebook")}
                        </>
                      )}
                    </Button>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel className="text-sm font-medium">
                      {t("integrations.step2SelectDestination")}
                    </FieldLabel>
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm text-muted-foreground">
                      {t("integrations.connectionType")}
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={integrations.facebookConnectionType === "page" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          integrations.setFacebookConnectionType("page");
                          integrations.setSelectedFacebookGroupId("");
                        }}
                      >
                        {t("integrations.facebookPage")}
                      </Button>
                      <Button
                        type="button"
                        variant={integrations.facebookConnectionType === "group" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          integrations.setFacebookConnectionType("group");
                          integrations.setSelectedFacebookPageId("");
                        }}
                      >
                        {t("integrations.facebookGroup")}
                      </Button>
                    </div>
                  </Field>

                  {integrations.facebookConnectionType === "page" ? (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.facebookPage")}
                      </FieldLabel>
                      <Select value={integrations.selectedFacebookPageId} onValueChange={integrations.setSelectedFacebookPageId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectPage")} />
                        </SelectTrigger>
                        <SelectContent>
                          {integrations.facebookTargets
                            .filter((target) => target.id.startsWith("page:"))
                            .map((page) => (
                            <SelectItem key={page.id} value={page.id.replace("page:", "")}>
                              {page.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.facebookGroup")}
                      </FieldLabel>
                      <Select value={integrations.selectedFacebookGroupId} onValueChange={integrations.setSelectedFacebookGroupId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectGroup")} />
                        </SelectTrigger>
                        <SelectContent>
                          {integrations.facebookTargets
                            .filter((target) => target.id.startsWith("group:"))
                            .map((group) => (
                            <SelectItem key={group.id} value={group.id.replace("group:", "")}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {integrations.facebookConnectionType === "page"
                        ? t("integrations.facebookPageAutoPublishNote")
                        : t("integrations.facebookGroupAutoImportNote")}
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
                {integrations.facebookStep === "select" && (
                  <Button
                    onClick={integrations.handleActivateFacebook}
                    disabled={
                      integrations.facebookConnectionType === "page"
                        ? !integrations.selectedFacebookPageId
                        : !integrations.selectedFacebookGroupId
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
    </div>
  );
}
