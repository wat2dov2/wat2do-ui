/**
 * AppLayout Component
 * Refactored to use AppContext - eliminates 12 props
 */

import React from "react";
import { TopNav } from "@/app/TopNav";
import { Sidebar } from "@/app/Sidebar";
import { useAppContext } from "@/contexts/AppContext";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { pageMode } = useAppContext();

  return (
    <div className="h-dvh flex flex-col">
      <TopNav />

      <div className="flex overflow-hidden flex-1">
        <Sidebar />

        {/* Main Content */}
        <div
          className="flex-1 overflow-auto ml-12 mt-12 p-6 main-content-grid"
          style={{
            minHeight: "calc(100vh - 48px)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
