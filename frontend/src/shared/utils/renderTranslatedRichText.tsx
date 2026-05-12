import React from "react";
import { sanitizeTranslationHTML } from "@/shared/utils/string";

type Tag = "strong" | "em";

/**
 * Render a translation string that may contain `<strong>` and `<em>` inline
 * formatting as a fragment of React nodes. Use this instead of feeding the
 * sanitized HTML into `dangerouslySetInnerHTML`.
 *
 * The input is first run through {@link sanitizeTranslationHTML}, so any
 * disallowed tags or attributes are stripped before parsing.
 */
export function renderTranslatedRichText(raw: string): React.ReactNode {
  const sanitized = sanitizeTranslationHTML(raw);

  const nodes: React.ReactNode[] = [];
  const stack: Tag[] = [];
  const childrenStack: React.ReactNode[][] = [nodes];
  let buf = "";
  let key = 0;

  const flushText = () => {
    if (!buf) return;
    childrenStack[childrenStack.length - 1].push(buf);
    buf = "";
  };

  const tokenRegex = /<\/?(strong|em)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(sanitized)) !== null) {
    buf += sanitized.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const tag = match[1] as Tag;
    const isClose = match[0].startsWith("</");
    if (!isClose) {
      flushText();
      stack.push(tag);
      childrenStack.push([]);
    } else {
      flushText();
      const top = stack.pop();
      const inner = childrenStack.pop() ?? [];
      if (top !== tag) {
        // Mismatched/unbalanced close — drop the tag and re-attach inner content
        childrenStack[childrenStack.length - 1].push(...inner);
        continue;
      }
      const Element = tag;
      childrenStack[childrenStack.length - 1].push(
        <Element key={`rtxt-${key++}`}>{inner}</Element>,
      );
    }
  }
  buf += sanitized.slice(lastIndex);
  flushText();

  // Any unclosed tags — flush their children to the parent.
  while (childrenStack.length > 1) {
    const inner = childrenStack.pop() ?? [];
    childrenStack[childrenStack.length - 1].push(...inner);
  }

  return <>{nodes}</>;
}
