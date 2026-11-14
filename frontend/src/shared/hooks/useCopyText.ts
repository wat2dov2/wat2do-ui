import { useEffect, useRef, useState } from "react";
import { toast } from "@/shared/hooks/use-toast";

const COPIED_FOR_MS = 1600;

interface CopyMessages {
  /** Toast after the text is on the clipboard. */
  copied: string;
  /** Toast when the browser refuses the clipboard. */
  failed: string;
}

/**
 * Copies text to the clipboard and says so in a toast; `copied` stays true for a
 * moment after, so a button can show a check mark.
 */
export function useCopyText() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(text: string, messages: CopyMessages) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
      toast({ description: messages.copied, variant: "success" });
    } catch (err) {
      console.error("Failed to copy to the clipboard:", err);
      toast({ description: messages.failed, variant: "destructive" });
    }
  }

  return { copied, copy };
}
