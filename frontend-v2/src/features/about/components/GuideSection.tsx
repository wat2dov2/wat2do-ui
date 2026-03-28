/**
 * GuideSection Component
 * Container for guide items
 */

import { useTranslation } from "react-i18next";
import { GuideItem } from "@/features/about/components/GuideItem";

interface GuideItemData {
  emoji: string;
  titleKey: string;
  paragraphs: Array<{ key: string }>;
  iconBgClass: string;
}

interface GuideSectionProps {
  items: GuideItemData[];
}

export function GuideSection({ items }: GuideSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-40">
      <div className="mb-16">
        <h2 className="font-sans font-bold text-[28px] text-foreground mb-4">
          {t("about.guideTitle")}
        </h2>
        <p className="font-sans text-[16px] text-muted-foreground">
          {t("about.guideDescription")}
        </p>
      </div>

      <div className="space-y-16">
        {items.map((item) => (
          <GuideItem
            key={item.titleKey}
            emoji={item.emoji}
            titleKey={item.titleKey}
            paragraphs={item.paragraphs}
            iconBgClass={item.iconBgClass}
          />
        ))}
      </div>
    </div>
  );
}
