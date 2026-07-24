import { Section, Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { OrganizationTypeIcon } from "@/shared/components/OrganizationTypeIcon";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import { OrganizationCategoryBadge } from "@/shared/components/OrganizationCategoryBadge";
import { ORGANIZATION_CATEGORY_STYLE_SLUGS } from "@/shared/data/organizationCategoryStyles";
import { ORGANIZATION_TYPE_SIGNATURES } from "@/shared/data/organizationTypeAssets";
import { ShowcaseBlock } from "./ShowcaseBlock";

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "destructive",
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


        <ShowcaseBlock label="Organization categories (fixed registry: colour + icon + label per slug)">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...ORGANIZATION_CATEGORY_STYLE_SLUGS, "not-a-category"].map((slug) => (
              <OrganizationCategoryBadge key={slug} type={slug} />
            ))}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Student association wordmarks (one per school, inherit currentColor)">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {ORGANIZATION_TYPE_SIGNATURES.map((signature) => {
              const [school, organizationType] = signature.split(":");
              return (
              <div key={signature} className="flex items-center gap-2">
                <OrganizationTypeIcon
                  school={school}
                  organizationType={organizationType}
                />
                <span className="truncate text-xs text-muted-foreground">
                  {organizationType.toUpperCase()} - {getSchoolDisplayName(school)}
                </span>
              </div>
              );
            })}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Association badge renders nothing when unaffiliated or school has none">
          <Stack direction="horizontal" gap={2} align="center" className="text-xs text-muted-foreground">
            <span>independent:</span>
            <OrganizationTypeIcon school="uwaterloo" organizationType="independent" />
            <span>| unknown school:</span>
            <OrganizationTypeIcon school="not-a-school" organizationType="wusa" />
            <span>| (both empty)</span>
          </Stack>
        </ShowcaseBlock>

      </Stack>
    </Section>
  );
}
