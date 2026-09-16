import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Facebook,
  Linkedin,
  Mail,
} from "@/shared/ui/doodle-icons";
import {
  DiscordIcon,
  LineIcon,
  WeChatIcon,
} from "@/shared/ui/platform-icons";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/hooks/use-toast";
import { DrawerBody, Stack } from "@/shared/layout";
import { tracker } from "@/shared/services/trackingService";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { buildEventShareUrl } from "@/features/events/lib/eventUrls";
import type { Event } from "@/shared/types";

interface EventShareDialogProps {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ShareChannelId =
  | "facebook"
  | "linkedin"
  | "x"
  | "line"
  | "wechat"
  | "discord"
  | "email";

interface ShareChannel {
  id: ShareChannelId;
  labelKey: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: string | number }>;
  bgClass: string;
}

const CHANNELS: ShareChannel[] = [
  { id: "facebook", labelKey: "events.shareDialog.channels.facebook", Icon: Facebook, bgClass: "bg-[#1877F2]" },
  { id: "linkedin", labelKey: "events.shareDialog.channels.linkedin", Icon: Linkedin, bgClass: "bg-[#0A66C2]" },
  { id: "x", labelKey: "events.shareDialog.channels.x", Icon: XLogo, bgClass: "bg-black" },
  { id: "line", labelKey: "events.shareDialog.channels.line", Icon: LineIcon, bgClass: "bg-[#06C755]" },
  { id: "wechat", labelKey: "events.shareDialog.channels.wechat", Icon: WeChatIcon, bgClass: "bg-[#07C160]" },
  { id: "discord", labelKey: "events.shareDialog.channels.discord", Icon: DiscordIcon, bgClass: "bg-[#5865F2]" },
  { id: "email", labelKey: "events.shareDialog.channels.email", Icon: Mail, bgClass: "bg-zinc-600" },
];

function encode(value: string) {
  return encodeURIComponent(value);
}

function openExternalShare(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M13.8 10.47 21.2 2h-1.75l-6.43 7.35L7.88 2H2l7.76 11.09L2 22h1.75l6.79-7.77L15.96 22h5.88l-8.04-11.53Zm-2.4 2.75-.79-1.1L4.36 3.3h2.68l5.06 7.14.78 1.1 6.57 9.27h-2.68l-5.37-7.59Z" />
    </svg>
  );
}

export function EventShareDialog({
  event,
  open,
  onOpenChange,
}: EventShareDialogProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const [copied, setCopied] = useState(false);
  const [wechatQrVisible, setWechatQrVisible] = useState(false);
  const shareUrl = useMemo(() => buildEventShareUrl(event.id), [event.id]);
  const cardDate = formatCardDate(event, getSchoolTimezone(event.school), i18n.language);
  const cardTime = formatCardTime(event, getSchoolTimezone(event.school), i18n.language);
  const shareText = [
    event.title,
    [cardDate, cardTime].filter(Boolean).join(` ${t("common.at")} `),
    event.location,
  ].filter(Boolean).join("\n");
  const shareBody = `${shareText}\n${shareUrl}`;

  async function copyLink(message?: string) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast({
        description: message ?? t("events.shareDialog.linkCopied"),
        variant: "success",
      });
    } catch (err) {
      console.error("Failed to copy event link:", err);
      toast({
        description: t("events.shareDialog.copyFailed"),
        variant: "destructive",
      });
    }
  }

  function handleCopy() {
    tracker.track(event.id, "share", { channel: "copy" });
    void copyLink();
  }

  async function shareWithWechat() {
    if (typeof navigator.share !== "function") {
      setWechatQrVisible(true);
      return;
    }

    try {
      await navigator.share({
        title: event.title,
        text: shareText,
        url: shareUrl,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      console.error("Failed to share event through WeChat:", err);
      setWechatQrVisible(true);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setWechatQrVisible(false);
    }
    onOpenChange(nextOpen);
  }

  function handleShare(channel: ShareChannelId) {
    tracker.track(event.id, "share", { channel });

    if (channel === "facebook") {
      openExternalShare(`https://www.facebook.com/sharer/sharer.php?u=${encode(shareUrl)}`);
      return;
    }
    if (channel === "linkedin") {
      openExternalShare(`https://www.linkedin.com/sharing/share-offsite/?url=${encode(shareUrl)}`);
      return;
    }
    if (channel === "x") {
      openExternalShare(`https://x.com/intent/post?text=${encode(event.title)}&url=${encode(shareUrl)}`);
      return;
    }
    if (channel === "line") {
      openExternalShare(
        `https://social-plugins.line.me/lineit/share?url=${encode(shareUrl)}&text=${encode(shareText)}`,
      );
      return;
    }
    if (channel === "wechat") {
      void shareWithWechat();
      return;
    }
    if (channel === "discord") {
      void copyLink(t("events.shareDialog.linkCopiedForDiscord"));
      openExternalShare("https://discord.com/channels/@me");
      return;
    }

    window.location.assign(`mailto:?subject=${encode(event.title)}&body=${encode(shareBody)}`);
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="overflow-hidden p-0">

        <DrawerHeader className="text-left">
          <DrawerTitle>{t("common.share")}</DrawerTitle>
          <DrawerDescription className="sr-only">
            {t("events.shareDialog.description")}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="mx-auto w-full max-w-sm pt-0">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/50 p-1.5 pl-3">
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {shareUrl}
            </span>
            <Button
              type="button"
              onMouseDown={handleCopy}
              size="sm"
              className="shrink-0 gap-1.5 rounded-lg px-3 text-xs"
            >
              {copied && <Check className="size-3.5" />}
              {t("events.shareDialog.copy")}
            </Button>
          </div>

          {wechatQrVisible ? (
            <Stack align="center" gap={4} className="py-2 text-center">
              <div
                data-slot="wechat-share-qr"
                className="rounded-xl border border-border bg-background p-3"
              >
                <QRCodeSVG value={shareUrl} size={176} level="M" />
              </div>
              <Stack align="center" gap={1}>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("events.shareDialog.wechatQrTitle")}
                </h3>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t("events.shareDialog.wechatQrDescription")}
                </p>
              </Stack>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onMouseDown={() => setWechatQrVisible(false)}
              >
                {t("common.back")}
              </Button>
            </Stack>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              {CHANNELS.map(({ id, labelKey, Icon, bgClass }) => {
                const label = t(labelKey);
                return (
                  <button
                    key={id}
                    type="button"
                    onMouseDown={() => handleShare(id)}
                    className="flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors hover:bg-secondary-hover"
                    aria-label={t("events.shareDialog.shareOn", { channel: label })}
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-full text-white ${bgClass}`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <span className="text-[11px] font-medium text-foreground">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
