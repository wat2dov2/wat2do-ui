/**
 * GuideItem Component
 * Reusable component for guide section items
 */

import { useTranslation } from "react-i18next";
import { renderTranslatedRichText } from "@/shared/utils/renderTranslatedRichText";

interface GuideItemProps {
  emoji: string;
  titleKey: string;
  paragraphs: Array<{
    key: string;
  }>;
  iconBgClass: string;
}

export function GuideItem({
  emoji,
  titleKey,
  paragraphs,
  iconBgClass,
}: GuideItemProps) {
  const { t } = useTranslation();

  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div
          className={`w-10 h-10 ${iconBgClass} rounded-full flex items-center justify-center flex-shrink-0`}
        >
          <span className="text-[20px]">{emoji}</span>
        </div>
        <h3 className="font-sans font-semibold text-[22px] text-foreground">
          {t(titleKey)}
        </h3>
      </div>
      <div className="font-sans text-[15px] text-foreground leading-relaxed space-y-3 ml-13">
        {paragraphs.map((para) => (
          <p key={para.key}>{renderTranslatedRichText(t(para.key))}</p>
        ))}
      </div>
    </section>
  );
}
