import { useState, useCallback } from "react";
import type { IntegrationServerOption } from "@/features/club-panel/api/integrations.api";

export interface DiscordFlowState {
  modalOpen: boolean;
  step: "connect" | "select";
  selectedServerId: string;
  selectedChannelId: string;
  botAdded: boolean;
}

const INITIAL_DISCORD_STATE: DiscordFlowState = {
  modalOpen: false,
  step: "connect",
  selectedServerId: "",
  selectedChannelId: "",
  botAdded: false,
};

export function useDiscordIntegration(
  servers: IntegrationServerOption[],
  oauthUrl: string,
  applyConnection: (name: string, metadata: Record<string, string>) => void
) {
  const [state, setState] = useState<DiscordFlowState>(INITIAL_DISCORD_STATE);

  const setModalOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, modalOpen: open }));
  }, []);

  const setSelectedServerId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedServerId: id }));
  }, []);

  const setSelectedChannelId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedChannelId: id }));
  }, []);

  const openFlow = useCallback(() => {
    setState({ ...INITIAL_DISCORD_STATE, modalOpen: true });
  }, []);

  const handleAddBot = useCallback(() => {
    if (oauthUrl) {
      window.open(oauthUrl, "_blank", "noopener,noreferrer");
    }
    setState((prev) => ({ ...prev, botAdded: true, step: "select" }));
  }, [oauthUrl]);

  const handleActivate = useCallback(() => {
    const server = servers.find((s) => s.id === state.selectedServerId);
    const channel = server?.channels.find((c) => c.id === state.selectedChannelId);
    if (!server || !channel) return;
    applyConnection(`${server.name} - ${channel.name}`, {
      server_id: server.id,
      server_name: server.name,
      channel_id: channel.id,
      channel_name: channel.name,
    });
    setState((prev) => ({ ...prev, modalOpen: false }));
  }, [servers, state.selectedServerId, state.selectedChannelId, applyConnection]);

  const selectedServer = servers.find((s) => s.id === state.selectedServerId);
  const selectedChannels = selectedServer?.channels ?? [];

  return {
    ...state,
    setModalOpen,
    setSelectedServerId,
    setSelectedChannelId,
    openFlow,
    handleAddBot,
    handleActivate,
    servers,
    selectedServer,
    selectedChannels,
  };
}
