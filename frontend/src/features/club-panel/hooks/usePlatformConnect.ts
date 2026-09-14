import { useState, useCallback } from "react";
import type { IntegrationServerOption, IntegrationChannelOption } from "@/features/club-panel/api/integrations.api";

interface PlatformConnectState {
  modalOpen: boolean;
  step: "connect" | "select";
  authorized: boolean;
  selectedPrimaryId: string;
  selectedSecondaryId: string;
}

const INITIAL_STATE: PlatformConnectState = {
  modalOpen: false,
  step: "connect",
  authorized: false,
  selectedPrimaryId: "",
  selectedSecondaryId: "",
};

interface UsePlatformConnectOptions {
  servers: IntegrationServerOption[];
  oauthUrl?: string;
  applyConnection: (name: string, metadata: Record<string, string>) => void;
  buildConnectionPayload: (
    primary: IntegrationServerOption,
    secondary: IntegrationChannelOption | undefined
  ) => { name: string; metadata: Record<string, string> } | null;
}

export function usePlatformConnect({
  servers,
  oauthUrl,
  applyConnection,
  buildConnectionPayload,
}: UsePlatformConnectOptions) {
  const [state, setState] = useState<PlatformConnectState>(INITIAL_STATE);

  const setModalOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, modalOpen: open }));
  }, []);

  const openFlow = useCallback(() => {
    setState({ ...INITIAL_STATE, modalOpen: true });
  }, []);

  const setSelectedPrimaryId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedPrimaryId: id, selectedSecondaryId: "" }));
  }, []);

  const setSelectedSecondaryId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedSecondaryId: id }));
  }, []);

  const handleAuthorize = useCallback(() => {
    if (oauthUrl) {
      window.open(oauthUrl, "_blank", "noopener,noreferrer");
    }
    setState((prev) => ({ ...prev, authorized: true, step: "select" }));
  }, [oauthUrl]);

  const handleActivate = useCallback(() => {
    const primary = servers.find((s) => s.id === state.selectedPrimaryId);
    if (!primary) return;
    const secondary = primary.channels?.find((c) => c.id === state.selectedSecondaryId);
    const payload = buildConnectionPayload(primary, secondary);
    if (!payload) return;
    applyConnection(payload.name, payload.metadata);
    setState((prev) => ({ ...prev, modalOpen: false }));
  }, [servers, state.selectedPrimaryId, state.selectedSecondaryId, applyConnection, buildConnectionPayload]);

  const selectedPrimary = servers.find((s) => s.id === state.selectedPrimaryId);
  const secondaryOptions = selectedPrimary?.channels ?? [];

  return {
    ...state,
    setModalOpen,
    openFlow,
    setSelectedPrimaryId,
    setSelectedSecondaryId,
    handleAuthorize,
    handleActivate,
    servers,
    secondaryOptions,
  };
}
