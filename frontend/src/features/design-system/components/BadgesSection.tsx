import { Section, Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { OrganizationAssociationBadge } from "@/shared/components/OrganizationAssociationBadge";
import {
  SCHOOLS_WITH_ASSOCIATIONS,
  getSchoolDisplayName,
  getStudentAssociation,
} from "@/shared/constants/schools";
import { OrganizationTypeBadge } from "@/shared/components/OrganizationTypeBadge";
import { ORGANIZATION_TYPE_SLUGS } from "@/shared/data/organizationTypes";
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
            {[...ORGANIZATION_TYPE_SLUGS, "not-a-category"].map((slug) => (
              <OrganizationTypeBadge key={slug} type={slug} />
            ))}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Student association wordmarks (one per school, inherit currentColor)">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {SCHOOLS_WITH_ASSOCIATIONS.map((school) => (
              <div key={school} className="flex items-center gap-2">
                <OrganizationAssociationBadge school={school} affiliated />
                <span className="truncate text-xs text-muted-foreground">
                  {getStudentAssociation(school)?.shortName} - {getSchoolDisplayName(school)}
                </span>
              </div>
            ))}
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Association badge renders nothing when unaffiliated or school has none">
          <Stack direction="horizontal" gap={2} align="center" className="text-xs text-muted-foreground">
            <span>affiliated=false:</span>
            <OrganizationAssociationBadge school="uwaterloo" affiliated={false} />
            <span>| unknown school:</span>
            <OrganizationAssociationBadge school="not-a-school" affiliated />
            <span>| (both empty)</span>
          </Stack>
        </ShowcaseBlock>

      </Stack>
    </Section>
  );
}
