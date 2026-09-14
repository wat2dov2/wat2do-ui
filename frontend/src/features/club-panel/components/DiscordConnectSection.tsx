import { DiscordConnectModal } from "./DiscordConnectModal";
import type { useDiscordIntegration } from "../hooks/useDiscordIntegration";

type DiscordHookState = ReturnType<typeof useDiscordIntegration>;

interface DiscordConnectSectionProps {
  discord: DiscordHookState;
  saving: boolean;
  selectedClubId: number | null;
}

export function DiscordConnectSection({ discord, saving, selectedClubId }: DiscordConnectSectionProps) {
  return (
    <DiscordConnectModal
      open={discord.modalOpen}
      onOpenChange={discord.setModalOpen}
      step={discord.step}
      botAdded={discord.botAdded}
      selectedServerId={discord.selectedServerId}
      selectedChannelId={discord.selectedChannelId}
      servers={discord.servers}
      selectedChannels={discord.selectedChannels}
      onAddBot={discord.handleAddBot}
      onSelectServer={discord.setSelectedServerId}
      onSelectChannel={discord.setSelectedChannelId}
      onActivate={discord.handleActivate}
      saving={saving}
      selectedClubId={selectedClubId}
    />
  );
}
