import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface DemoSplitLayoutProps {
  left: ReactNode;
  right?: ReactNode;
  dark?: boolean;
  className?: string;
}

export function DemoSplitLayout({ left, right, dark = false, className }: DemoSplitLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-col lg:flex-row w-full min-h-0 flex-1 gap-6 lg:gap-0",
        dark && "text-foreground",
        className
      )}
    >
      <div className="flex flex-col justify-center w-full lg:w-1/2 lg:pr-8 xl:pr-12 min-h-0">
        {left}
      </div>
      {right && (
        <div className="flex flex-col justify-center w-full lg:w-1/2 lg:pl-8 xl:pl-12 min-h-0">
          {right}
        </div>
      )}
    </div>
  );
}
