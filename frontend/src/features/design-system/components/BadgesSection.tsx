import { Section, Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { ClubTypeIcon } from "@/shared/components/ClubTypeIcon";
import { ClubCategoryBadge } from "@/shared/components/ClubCategoryBadge";
import { CLUB_CATEGORY_STYLE_SLUGS } from "@/shared/data/clubCategoryStyles";
import { CLUB_TYPE_SIGNATURES } from "@/shared/data/clubTypeAssets";
import { ShowcaseBlock } from "./ShowcaseBlock";

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "destructive",
  "success",
  "warning",
  "muted",
  "outline",
  "live",
  "soon",
  "new",
] as const;

export function BadgesSection() {
  return (
    <Section
      id="badges"
      title="Badges"
      description="Compact status and category indicators."
      variant="surface"
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Avatar stack with fallback and overflow">
          <AvatarStack
            avatars={[{ name: "Alex", src: "" }, { name: "Sam", src: "" }, { name: "Taylor", src: "" }]}
            overflowCount={3}
            overflowLabel="3 more people"
          />
        </ShowcaseBlock>
        <ShowcaseBlock label="Variants">
          <Stack direction="horizontal" gap={2} align="center" className="flex-wrap">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Sizes">
          <Stack direction="horizontal" gap={2} align="center">
            <Badge size="sm">Small</Badge>
            <Badge size="md">Medium</Badge>
            <Badge size="lg">Large</Badge>
          </Stack>
        </ShowcaseBlock>


        <ShowcaseBlock label="Club categories (fixed registry: colour + icon + label per slug)">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...CLUB_CATEGORY_STYLE_SLUGS, "not-a-category"].map((slug) => (
              <ClubCategoryBadge key={slug} type={slug} />
            ))}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Student association wordmarks (one per school, inherit currentColor)">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {CLUB_TYPE_SIGNATURES.map((signature) => {
              const [school, clubType] = signature.split(":");
              return (
              <div key={signature} className="flex items-center gap-2">
                <ClubTypeIcon
                  school={school}
                  clubType={clubType}
                />
                <span className="truncate text-xs text-muted-foreground">
                  {clubType.toUpperCase()} - {school}
                </span>
              </div>
              );
            })}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Association badge renders nothing when unaffiliated or school has none">
          <Stack direction="horizontal" gap={2} align="center" className="text-xs text-muted-foreground">
            <span>independent:</span>
            <ClubTypeIcon school="uwaterloo" clubType="independent" />
            <span>| unknown school:</span>
            <ClubTypeIcon school="not-a-school" clubType="wusa" />
            <span>| (both empty)</span>
          </Stack>
        </ShowcaseBlock>

      </Stack>
    </Section>
  );
}
