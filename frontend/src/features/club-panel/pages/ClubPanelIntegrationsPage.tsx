import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Link, MessageCircle, Check, ExternalLink, AtSign } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useNavigation } from "@/contexts/NavigationContext";
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

// Discord icon component
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// Instagram icon component
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

// Slack icon component
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

// Telegram icon component
function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// LinkedIn icon component
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// Facebook icon component
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// Mock data for Discord servers and channels
const mockDiscordServers = [
  { id: "1", name: "UW Tech Club" },
  { id: "2", name: "CS Student Association" },
  { id: "3", name: "Engineering Society" },
];

const mockDiscordChannels: Record<string, { id: string; name: string }[]> = {
  "1": [
    { id: "101", name: "#events" },
    { id: "102", name: "#announcements" },
    { id: "103", name: "#general" },
  ],
  "2": [
    { id: "201", name: "#events" },
    { id: "202", name: "#news" },
  ],
  "3": [
    { id: "301", name: "#upcoming-events" },
    { id: "302", name: "#socials" },
  ],
};

// Mock data for Slack workspaces and channels
const mockSlackWorkspaces = [
  { id: "1", name: "UW Tech Club Workspace" },
  { id: "2", name: "CS Students" },
  { id: "3", name: "Engineering Hub" },
];

const mockSlackChannels: Record<string, { id: string; name: string }[]> = {
  "1": [
    { id: "101", name: "#events" },
    { id: "102", name: "#announcements" },
    { id: "103", name: "#general" },
  ],
  "2": [
    { id: "201", name: "#club-events" },
    { id: "202", name: "#news" },
  ],
  "3": [
    { id: "301", name: "#upcoming" },
    { id: "302", name: "#socials" },
  ],
};

// Mock data for Telegram groups
const mockTelegramGroups = [
  { id: "1", name: "UW Tech Club" },
  { id: "2", name: "CS Events" },
  { id: "3", name: "Engineering Society" },
];

// Mock data for LinkedIn pages
const mockLinkedinPages = [
  { id: "1", name: "UW Tech Club" },
  { id: "2", name: "CS Student Association" },
  { id: "3", name: "Engineering Society" },
];

// Mock data for Facebook pages and groups
const mockFacebookPages = [
  { id: "1", name: "UW Tech Club" },
  { id: "2", name: "CS Student Association" },
  { id: "3", name: "Engineering Society" },
];

const mockFacebookGroups = [
  { id: "1", name: "UW Tech Club Members" },
  { id: "2", name: "CS Events & Announcements" },
  { id: "3", name: "Engineering Student Hub" },
];

type IntegrationPlatform = "whatsapp" | "discord" | "instagram" | "slack" | "telegram" | "linkedin" | "facebook";

interface Integration {
  platform: IntegrationPlatform;
  connected: boolean;
  name?: string;
  lastSync?: string;
  serverId?: string;
  channelId?: string;
  workspaceId?: string;
  handle?: string;
  pageId?: string;
  groupId?: string;
  connectionType?: "page" | "group";
}

export function ClubPanelIntegrationsPage() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();

  // Integration states (mock - not persisted)
  const [integrations, setIntegrations] = useState<Integration[]>([
    { platform: "whatsapp", connected: false },
    { platform: "discord", connected: false },
    { platform: "instagram", connected: false },
    { platform: "slack", connected: false },
    { platform: "telegram", connected: false },
    { platform: "linkedin", connected: false },
    { platform: "facebook", connected: false },
  ]);

  // Modal states
  const [discordModalOpen, setDiscordModalOpen] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [instagramModalOpen, setInstagramModalOpen] = useState(false);
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [facebookModalOpen, setFacebookModalOpen] = useState(false);

  // Discord connection flow state
  const [discordStep, setDiscordStep] = useState<"connect" | "select">("connect");
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [botAdded, setBotAdded] = useState(false);

  // Slack connection flow state
  const [slackStep, setSlackStep] = useState<"connect" | "select">("connect");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedSlackChannelId, setSelectedSlackChannelId] = useState<string>("");
  const [slackAppAdded, setSlackAppAdded] = useState(false);

  // Instagram connection state
  const [instagramHandle, setInstagramHandle] = useState<string>("");

  // Telegram connection state
  const [telegramStep, setTelegramStep] = useState<"connect" | "select">("connect");
  const [telegramBotAdded, setTelegramBotAdded] = useState(false);
  const [selectedTelegramGroupId, setSelectedTelegramGroupId] = useState<string>("");

  // LinkedIn connection state
  const [linkedinStep, setLinkedinStep] = useState<"connect" | "select">("connect");
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [selectedLinkedinPageId, setSelectedLinkedinPageId] = useState<string>("");

  // Facebook connection state
  const [facebookStep, setFacebookStep] = useState<"connect" | "select">("connect");
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookConnectionType, setFacebookConnectionType] = useState<"page" | "group">("page");
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState<string>("");
  const [selectedFacebookGroupId, setSelectedFacebookGroupId] = useState<string>("");

  const getIntegration = (platform: IntegrationPlatform) =>
    integrations.find((i) => i.platform === platform);

  const handleConnect = (platform: IntegrationPlatform) => {
    switch (platform) {
      case "discord":
        setDiscordStep("connect");
        setBotAdded(false);
        setSelectedServerId("");
        setSelectedChannelId("");
        setDiscordModalOpen(true);
        break;
      case "whatsapp":
        setWhatsappModalOpen(true);
        break;
      case "instagram":
        setInstagramHandle("");
        setInstagramModalOpen(true);
        break;
      case "slack":
        setSlackStep("connect");
        setSlackAppAdded(false);
        setSelectedWorkspaceId("");
        setSelectedSlackChannelId("");
        setSlackModalOpen(true);
        break;
      case "telegram":
        setTelegramStep("connect");
        setTelegramBotAdded(false);
        setSelectedTelegramGroupId("");
        setTelegramModalOpen(true);
        break;
      case "linkedin":
        setLinkedinStep("connect");
        setLinkedinConnected(false);
        setSelectedLinkedinPageId("");
        setLinkedinModalOpen(true);
        break;
      case "facebook":
        setFacebookStep("connect");
        setFacebookConnected(false);
        setFacebookConnectionType("page");
        setSelectedFacebookPageId("");
        setSelectedFacebookGroupId("");
        setFacebookModalOpen(true);
        break;
    }
  };

  const handleDisconnect = (platform: IntegrationPlatform) => {
    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === platform
          ? { platform, connected: false }
          : i
      )
    );
  };

  const handleAddToDiscord = () => {
    // Simulate OAuth flow - in real implementation this would redirect to Discord OAuth
    setBotAdded(true);
    setDiscordStep("select");
  };

  const handleActivateDiscord = () => {
    const server = mockDiscordServers.find((s) => s.id === selectedServerId);
    const channel = mockDiscordChannels[selectedServerId]?.find(
      (c) => c.id === selectedChannelId
    );

    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "discord"
          ? {
              platform: "discord",
              connected: true,
              name: `${server?.name} - ${channel?.name}`,
              lastSync: new Date().toISOString(),
              serverId: selectedServerId,
              channelId: selectedChannelId,
            }
          : i
      )
    );
    setDiscordModalOpen(false);
  };

  const handleWhatsAppDone = () => {
    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "whatsapp"
          ? {
              platform: "whatsapp",
              connected: true,
              name: "UW Tech Club Group",
              lastSync: new Date().toISOString(),
            }
          : i
      )
    );
    setWhatsappModalOpen(false);
  };

  // Instagram handlers
  const handleInstagramConnect = () => {
    if (!instagramHandle) return;
    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "instagram"
          ? {
              platform: "instagram",
              connected: true,
              name: `@${instagramHandle}`,
              handle: instagramHandle,
              lastSync: new Date().toISOString(),
            }
          : i
      )
    );
    setInstagramModalOpen(false);
  };

  // Slack handlers
  const handleAddToSlack = () => {
    setSlackAppAdded(true);
    setSlackStep("select");
  };

  const handleActivateSlack = () => {
    const workspace = mockSlackWorkspaces.find((w) => w.id === selectedWorkspaceId);
    const channel = mockSlackChannels[selectedWorkspaceId]?.find(
      (c) => c.id === selectedSlackChannelId
    );

    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "slack"
          ? {
              platform: "slack",
              connected: true,
              name: `${workspace?.name} - ${channel?.name}`,
              lastSync: new Date().toISOString(),
              workspaceId: selectedWorkspaceId,
              channelId: selectedSlackChannelId,
            }
          : i
      )
    );
    setSlackModalOpen(false);
  };

  // Telegram handlers
  const handleAddTelegramBot = () => {
    setTelegramBotAdded(true);
    setTelegramStep("select");
  };

  const handleActivateTelegram = () => {
    const group = mockTelegramGroups.find((g) => g.id === selectedTelegramGroupId);

    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "telegram"
          ? {
              platform: "telegram",
              connected: true,
              name: group?.name,
              lastSync: new Date().toISOString(),
            }
          : i
      )
    );
    setTelegramModalOpen(false);
  };

  // LinkedIn handlers
  const handleLinkedinAuth = () => {
    setLinkedinConnected(true);
    setLinkedinStep("select");
  };

  const handleActivateLinkedin = () => {
    const page = mockLinkedinPages.find((p) => p.id === selectedLinkedinPageId);

    setIntegrations((prev) =>
      prev.map((i) =>
        i.platform === "linkedin"
          ? {
              platform: "linkedin",
              connected: true,
              name: page?.name,
              pageId: selectedLinkedinPageId,
              lastSync: new Date().toISOString(),
            }
          : i
      )
    );
    setLinkedinModalOpen(false);
  };

  // Facebook handlers
  const handleFacebookAuth = () => {
    setFacebookConnected(true);
    setFacebookStep("select");
  };

  const handleActivateFacebook = () => {
    if (facebookConnectionType === "page") {
      const page = mockFacebookPages.find((p) => p.id === selectedFacebookPageId);
      setIntegrations((prev) =>
        prev.map((i) =>
          i.platform === "facebook"
            ? {
                platform: "facebook",
                connected: true,
                name: page?.name,
                pageId: selectedFacebookPageId,
                connectionType: "page",
                lastSync: new Date().toISOString(),
              }
            : i
        )
      );
    } else {
      const group = mockFacebookGroups.find((g) => g.id === selectedFacebookGroupId);
      setIntegrations((prev) =>
        prev.map((i) =>
          i.platform === "facebook"
            ? {
                platform: "facebook",
                connected: true,
                name: group?.name,
                groupId: selectedFacebookGroupId,
                connectionType: "group",
                lastSync: new Date().toISOString(),
              }
            : i
        )
      );
    }
    setFacebookModalOpen(false);
  };

  const formatLastSync = (isoString?: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return t("common.justNow");
    if (diffMins < 60) return t("integrations.minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("integrations.hoursAgo", { count: diffHours });
    return date.toLocaleDateString();
  };

  const whatsappIntegration = getIntegration("whatsapp");
  const discordIntegration = getIntegration("discord");
  const instagramIntegration = getIntegration("instagram");
  const slackIntegration = getIntegration("slack");
  const telegramIntegration = getIntegration("telegram");
  const linkedinIntegration = getIntegration("linkedin");
  const facebookIntegration = getIntegration("facebook");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/club-panel")}
          className="shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Link className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("clubPanel.integrations")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("integrations.pageDescription")}
          </p>
        </div>
      </div>

      {/* Integration Cards */}
      <div className="space-y-4">
        {/* WhatsApp Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <MessageCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("clubPanel.whatsapp")}</h3>
                  {whatsappIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {whatsappIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {whatsappIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(whatsappIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.whatsappScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {whatsappIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("whatsapp")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("whatsapp")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("whatsapp")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Discord Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                <DiscordIcon className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("clubPanel.discord")}</h3>
                  {discordIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {discordIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {discordIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(discordIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.discordScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {discordIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("discord")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("discord")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("discord")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Instagram Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center shrink-0">
                <InstagramIcon className="w-6 h-6 text-pink-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("integrations.instagram")}</h3>
                  {instagramIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {instagramIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {instagramIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(instagramIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.instagramScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {instagramIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("instagram")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("instagram")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("instagram")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Slack Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <SlackIcon className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("integrations.slack")}</h3>
                  {slackIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {slackIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {slackIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(slackIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.slackScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {slackIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("slack")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("slack")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("slack")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Telegram Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                <TelegramIcon className="w-6 h-6 text-sky-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("integrations.telegram")}</h3>
                  {telegramIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {telegramIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {telegramIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(telegramIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.telegramScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {telegramIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("telegram")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("telegram")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("telegram")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* LinkedIn Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <LinkedInIcon className="w-6 h-6 text-blue-700" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("integrations.linkedin")}</h3>
                  {linkedinIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {linkedinIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {linkedinIntegration.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(linkedinIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.linkedinScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {linkedinIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("linkedin")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("linkedin")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("linkedin")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Facebook Integration */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <FacebookIcon className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{t("integrations.facebook")}</h3>
                  {facebookIntegration?.connected && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      {t("integrations.connected")}
                    </span>
                  )}
                </div>
                {facebookIntegration?.connected ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-700">
                      {facebookIntegration.name}
                      {facebookIntegration.connectionType === "group" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({t("integrations.groupChat")})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("integrations.lastSync")}: {formatLastSync(facebookIntegration.lastSync)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("integrations.facebookScrapeDesc")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {facebookIntegration?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect("facebook")}
                  >
                    {t("integrations.manage")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDisconnect("facebook")}
                  >
                    {t("integrations.disconnect")}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleConnect("facebook")}>
                  {t("integrations.connect")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Discord Connection Modal */}
      <Dialog open={discordModalOpen} onOpenChange={setDiscordModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectDiscord")}</DialogTitle>
              <DialogDescription>
                {discordStep === "connect"
                  ? t("integrations.discordStep1Desc")
                  : t("integrations.discordStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {discordStep === "connect" ? (
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
                      onClick={handleAddToDiscord}
                      disabled={botAdded}
                    >
                      {botAdded ? (
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
                    <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectServer")} />
                      </SelectTrigger>
                      <SelectContent>
                        {mockDiscordServers.map((server) => (
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
                        onValueChange={setSelectedChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {mockDiscordChannels[selectedServerId]?.map((channel) => (
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
                {discordStep === "select" && (
                  <Button
                    onClick={handleActivateDiscord}
                    disabled={!selectedServerId || !selectedChannelId}
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
      <Dialog open={whatsappModalOpen} onOpenChange={setWhatsappModalOpen}>
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
                <div className="p-4 bg-white rounded-lg border border-border mb-4">
                  <QRCodeSVG
                    value="https://wa.me/message/wat2do-bot-placeholder"
                    size={160}
                    level="M"
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center mb-4">
                  {t("common.or")}
                </p>
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href="https://wa.me/message/wat2do-bot-placeholder"
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
                <Button onClick={handleWhatsAppDone}>
                  {t("common.done")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Instagram Connection Modal */}
      <Dialog open={instagramModalOpen} onOpenChange={setInstagramModalOpen}>
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
                    value={instagramHandle}
                    onChange={(e) => setInstagramHandle(e.target.value)}
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
                  onClick={handleInstagramConnect}
                  disabled={!instagramHandle}
                >
                  {t("integrations.connect")}
                </Button>
              </Field>
            </FieldGroup>
          </ModalContentWrapper>
        </DialogContent>
      </Dialog>

      {/* Slack Connection Modal */}
      <Dialog open={slackModalOpen} onOpenChange={setSlackModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectSlack")}</DialogTitle>
              <DialogDescription>
                {slackStep === "connect"
                  ? t("integrations.slackStep1Desc")
                  : t("integrations.slackStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {slackStep === "connect" ? (
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
                      onClick={handleAddToSlack}
                      disabled={slackAppAdded}
                    >
                      {slackAppAdded ? (
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
                    <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectWorkspace")} />
                      </SelectTrigger>
                      <SelectContent>
                        {mockSlackWorkspaces.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {selectedWorkspaceId && (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.channel")}
                      </FieldLabel>
                      <Select
                        value={selectedSlackChannelId}
                        onValueChange={setSelectedSlackChannelId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectChannel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {mockSlackChannels[selectedWorkspaceId]?.map((channel) => (
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
                {slackStep === "select" && (
                  <Button
                    onClick={handleActivateSlack}
                    disabled={!selectedWorkspaceId || !selectedSlackChannelId}
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
      <Dialog open={telegramModalOpen} onOpenChange={setTelegramModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectTelegram")}</DialogTitle>
              <DialogDescription>
                {telegramStep === "connect"
                  ? t("integrations.telegramStep1Desc")
                  : t("integrations.telegramStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {telegramStep === "connect" ? (
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
                      onClick={handleAddTelegramBot}
                      disabled={telegramBotAdded}
                    >
                      {telegramBotAdded ? (
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
                    <Select value={selectedTelegramGroupId} onValueChange={setSelectedTelegramGroupId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectGroup")} />
                      </SelectTrigger>
                      <SelectContent>
                        {mockTelegramGroups.map((group) => (
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
                {telegramStep === "select" && (
                  <Button
                    onClick={handleActivateTelegram}
                    disabled={!selectedTelegramGroupId}
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
      <Dialog open={linkedinModalOpen} onOpenChange={setLinkedinModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectLinkedIn")}</DialogTitle>
              <DialogDescription>
                {linkedinStep === "connect"
                  ? t("integrations.linkedinStep1Desc")
                  : t("integrations.linkedinStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {linkedinStep === "connect" ? (
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
                      onClick={handleLinkedinAuth}
                      disabled={linkedinConnected}
                    >
                      {linkedinConnected ? (
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
                    <Select value={selectedLinkedinPageId} onValueChange={setSelectedLinkedinPageId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("integrations.selectPage")} />
                      </SelectTrigger>
                      <SelectContent>
                        {mockLinkedinPages.map((page) => (
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
                {linkedinStep === "select" && (
                  <Button
                    onClick={handleActivateLinkedin}
                    disabled={!selectedLinkedinPageId}
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
      <Dialog open={facebookModalOpen} onOpenChange={setFacebookModalOpen}>
        <DialogContent className="p-0 max-w-md">
          <ModalHeaderWrapper>
            <DialogHeader>
              <DialogTitle>{t("integrations.connectFacebook")}</DialogTitle>
              <DialogDescription>
                {facebookStep === "connect"
                  ? t("integrations.facebookStep1Desc")
                  : t("integrations.facebookStep2Desc")}
              </DialogDescription>
            </DialogHeader>
          </ModalHeaderWrapper>

          <ModalContentWrapper>
            <FieldGroup>
              {facebookStep === "connect" ? (
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
                      onClick={handleFacebookAuth}
                      disabled={facebookConnected}
                    >
                      {facebookConnected ? (
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
                        variant={facebookConnectionType === "page" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          setFacebookConnectionType("page");
                          setSelectedFacebookGroupId("");
                        }}
                      >
                        {t("integrations.facebookPage")}
                      </Button>
                      <Button
                        type="button"
                        variant={facebookConnectionType === "group" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          setFacebookConnectionType("group");
                          setSelectedFacebookPageId("");
                        }}
                      >
                        {t("integrations.facebookGroup")}
                      </Button>
                    </div>
                  </Field>

                  {facebookConnectionType === "page" ? (
                    <Field>
                      <FieldLabel className="text-sm text-muted-foreground">
                        {t("integrations.facebookPage")}
                      </FieldLabel>
                      <Select value={selectedFacebookPageId} onValueChange={setSelectedFacebookPageId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectPage")} />
                        </SelectTrigger>
                        <SelectContent>
                          {mockFacebookPages.map((page) => (
                            <SelectItem key={page.id} value={page.id}>
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
                      <Select value={selectedFacebookGroupId} onValueChange={setSelectedFacebookGroupId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("integrations.selectGroup")} />
                        </SelectTrigger>
                        <SelectContent>
                          {mockFacebookGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {facebookConnectionType === "page"
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
                {facebookStep === "select" && (
                  <Button
                    onClick={handleActivateFacebook}
                    disabled={
                      facebookConnectionType === "page"
                        ? !selectedFacebookPageId
                        : !selectedFacebookGroupId
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
