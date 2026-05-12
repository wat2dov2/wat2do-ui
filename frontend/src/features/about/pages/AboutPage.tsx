import { useTranslation } from "react-i18next";
import { Section } from "@/features/about/components/Section";
import { PhotoWithCaption } from "@/features/about/components/PhotoWithCaption";
import { GuideSection } from "@/features/about/components/GuideSection";
import { NewsletterForm } from "@/features/about/components/NewsletterForm";
import { renderTranslatedRichText } from "@/shared/utils/renderTranslatedRichText";

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[680px] mx-auto px-6 py-20 pb-32">
        
        {/* Opening */}
        <div className="mb-32">
          <p className="font-sans text-[11px] tracking-wider uppercase text-muted-foreground mb-3">
            {t("about.openingDate")}
          </p>
          <h1 className="font-sans font-semibold text-[32px] text-foreground mb-6 leading-tight">
            {t("about.openingTitle")}
          </h1>
          <div className="font-sans text-[16px] text-foreground leading-relaxed space-y-4">
            <p>{t("about.openingParagraph1")}</p>
            <p>{renderTranslatedRichText(t("about.openingParagraph2"))}</p>
            <p>{renderTranslatedRichText(t("about.openingParagraph3"))}</p>
            <p>{renderTranslatedRichText(t("about.openingParagraph4"))}</p>
          </div>
        </div>

        {/* Evidence Photo 1 */}
        <PhotoWithCaption
          src="https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?w=800&q=80"
          altKey="about.photo1Alt"
          captionKey="about.photo1Caption"
        />

        {/* Phase 2: The Build */}
        <Section
          dateKey="about.phase2Date"
          titleKey="about.phase2Title"
          paragraphs={[
            { key: "about.phase2Paragraph1", isHTML: true },
            { key: "about.phase2Paragraph2" },
            { key: "about.phase2Paragraph3" },
            { key: "about.phase2Paragraph4", className: "italic text-muted-foreground" },
          ]}
        />

        {/* Evidence Photo 2 */}
        <PhotoWithCaption
          src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80"
          altKey="about.photo2Alt"
          captionKey="about.photo2Caption"
        />

        {/* Phase 3: The Launch */}
        <Section
          dateKey="about.phase3Date"
          titleKey="about.phase3Title"
          paragraphs={[
            { key: "about.phase3Paragraph1" },
            { key: "about.phase3Paragraph2", isHTML: true },
            { key: "about.phase3Paragraph3", isHTML: true },
            { key: "about.phase3Paragraph4" },
          ]}
        />

        {/* Evidence Photo 3 */}
        <PhotoWithCaption
          src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80"
          altKey="about.photo3Alt"
          captionKey="about.photo3Caption"
        />

        {/* Today */}
        <Section
          dateKey="about.todayDate"
          titleKey="about.todayTitle"
          paragraphs={[
            { key: "about.todayParagraph1", isHTML: true },
            { key: "about.todayParagraph2" },
            { key: "about.todayParagraph3", className: "font-sans font-bold text-[17px] text-foreground" },
          ]}
          className="mb-40"
        />

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-40" />

        {/* Guide Section */}
        <GuideSection
          items={[
            {
              emoji: "💼",
              titleKey: "about.guideIndustryTitle",
              paragraphs: [
                { key: "about.guideIndustryWie" },
                { key: "about.guideIndustryAtlassian" },
                { key: "about.guideIndustryStartup" },
              ],
              iconBgClass: "bg-primary/10 dark:bg-primary/20",
            },
            {
              emoji: "✨",
              titleKey: "about.guideRandomTitle",
              paragraphs: [
                { key: "about.guideRandomRepair" },
                { key: "about.guideRandomGatka" },
                { key: "about.guideRandomRetro" },
              ],
              iconBgClass: "bg-success/10 dark:bg-success/20",
            },
            {
              emoji: "🍕",
              titleKey: "about.guideFriendsTitle",
              paragraphs: [
                { key: "about.guideFriendsFood" },
                { key: "about.guideFriendsGames" },
                { key: "about.guideFriendsWonderland" },
              ],
              iconBgClass: "bg-warning/10 dark:bg-warning/20",
            },
          ]}
        />

        {/* Newsletter */}
        <div className="mb-32">
          <NewsletterForm />
        </div>

        {/* Footer */}
        <footer className="pt-12 border-t border-border space-y-6">
          <p className="font-sans text-[14px] text-muted-foreground leading-relaxed">
            {renderTranslatedRichText(t("about.footerPS"))}
          </p>
          <p className="font-sans text-[13px] text-muted-foreground">
            {t("about.footerCopyright")}
          </p>
        </footer>
      </div>
    </div>
  );
}
