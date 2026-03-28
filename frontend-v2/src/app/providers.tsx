import React from "react";
import { TooltipProvider } from "@/shared/ui/tooltip";

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers
 * Centralizes all context providers for the application
 */
export function AppProviders({ children }: AppProvidersProps) {
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}
