/**
 * DiscordConnectSection
 * Thin wrapper around DiscordConnectModal that accepts the full discord hook
 * object as a single prop, keeping the page free of per-field destructuring.
 *
 * Maps hook field names to modal prop names via a stable adapter object.
 */

import { useMemo } from "react";
import { DiscordConnectModal } from "./DiscordConnectModal";
import { useDiscordIntegration } from "../hooks/useDiscordIntegration";

type DiscordHookState = ReturnType<typeof useDiscordIntegration>;

interface DiscordConnectSectionProps {
  discord: DiscordHookState;
  saving: boolean;
  selectedClubId: number | null;
}

/** Maps hook return names → DiscordConnectModal prop names. */
function toModalProps(d: DiscordHookState) {
  return {
    open: d.modalOpen,
    onOpenChange: d.setModalOpen,
    step: d.step,
    botAdded: d.botAdded,
    selectedServerId: d.selectedServerId,
    selectedChannelId: d.selectedChannelId,
    servers: d.servers,
    selectedChannels: d.selectedChannels,
    onAddBot: d.handleAddBot,
    onSelectServer: d.setSelectedServerId,
    onSelectChannel: d.setSelectedChannelId,
    onActivate: d.handleActivate,
  } as const;
}

export function DiscordConnectSection({ discord, saving, selectedClubId }: DiscordConnectSectionProps) {
  const modalProps = useMemo(() => toModalProps(discord), [discord]);

  return (
    <DiscordConnectModal
      {...modalProps}
      saving={saving}
      selectedClubId={selectedClubId}
    />
  );
}
