import type { ReactNode } from "react";
import { TopNav } from "@/app/TopNav";
import { BackToTopButton } from "@/shared/ui/back-to-top-button";
import { PageFrame } from "@/shared/layout";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopNav />

      <PageFrame
        className="main-content-grid mt-12 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {children}
      </PageFrame>

      <div className="pointer-events-none fixed right-2 bottom-4 z-50 sm:right-4">
        <BackToTopButton />
      </div>
    </div>
  );
}
