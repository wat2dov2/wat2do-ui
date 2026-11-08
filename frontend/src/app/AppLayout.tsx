import type { ReactNode } from "react";
import { SiteFooter } from "@/app/SiteFooter";
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

      {/* `relative` makes the scroller the containing block, so absolutely
          positioned content (e.g. Highlighter's drawn annotations) scrolls with
          the page instead of staying pinned to the viewport. */}
      <PageFrame
        className="main-content-grid relative mt-12 min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        footer={<SiteFooter />}
      >
        {children}
      </PageFrame>

      {/* Flex, so the wrapper has no line box and is always exactly its
          button's size. As a plain block it took the line height and font
          metrics it inherits, and the corner moved as they settled. */}
      <div className="pointer-events-none fixed right-2 bottom-4 z-50 flex sm:right-4">
        <BackToTopButton />
      </div>
    </div>
  );
}
