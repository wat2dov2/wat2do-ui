/**
 * Section Component
 * Reusable component for content sections with date, title, and paragraphs
 */

import { useTranslation } from "react-i18next";
import { renderTranslatedRichText } from "@/shared/utils/renderTranslatedRichText";

interface SectionProps {
  dateKey: string;
  titleKey: string;
  paragraphs: Array<{
    key: string;
    isHTML?: boolean;
    className?: string;
  }>;
  className?: string;
}

export function Section({
  dateKey,
  titleKey,
  paragraphs,
  className = "mb-32",
}: SectionProps) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
        {t(dateKey)}
      </p>
      <h2 className="font-sans font-semibold text-[28px] text-foreground mb-6 leading-tight">
        {t(titleKey)}
      </h2>
      <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
        {paragraphs.map((para) => (
          <p key={para.key} className={para.className}>
            {para.isHTML ? renderTranslatedRichText(t(para.key)) : t(para.key)}
          </p>
        ))}
      </div>
    </div>
  );
}
