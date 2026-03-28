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
          className="main-content-grid ml-[146px] mt-12 flex-1 overflow-auto p-4 sm:p-6"
          style={{
            minHeight: "calc(100vh - 48px)",
          }}
        >
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
