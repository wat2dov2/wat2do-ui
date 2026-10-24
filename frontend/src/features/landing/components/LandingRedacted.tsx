"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

/** Uneven line lengths, so a redacted paragraph reads like real wrapped text. */
const PARAGRAPH_LINE_WIDTHS = ["w-full", "w-11/12", "w-full", "w-3/5"] as const;

/**
 * Blurred bars standing in for a part of the pipeline we keep private. They
 * carry no text at all, so what they hide is absent from the page source and
 * its translations as well as from view; assistive tech hears "redacted".
 */
export function LandingRedacted({ lines = 1 }: { /** One bar inline, or several as a paragraph block. */ lines?: 1 | 4 }) {
  const { t } = useTranslation();
  const bar = "rounded-[0.2em] bg-current opacity-60 blur-[3px] select-none";

  if (lines === 1) {
    return <span role="img" aria-label={t("landing.different.redacted")} className={cn("inline-block h-[0.75em] w-[4.5em] align-[-0.05em]", bar)} />;
  }
  return (
    <span role="img" aria-label={t("landing.different.redacted")} className="flex flex-col gap-[0.55em] py-[0.2em]">
      {PARAGRAPH_LINE_WIDTHS.map((width, index) => <span key={index} className={cn("block h-[0.7em]", width, bar)} />)}
    </span>
  );
}
