import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { ChevronRight, Shapes, Ticket, Users } from "lucide-react";
import { ROUTES } from "@/shared/constants/routes";
import { Section } from "@/shared/layout";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { IconTile } from "@/shared/ui/tile";

// Every form is open to everyone: events and positions can be sent without an account, and the club form asks the visitor to sign in only when they send it. The footer links them too, for visitors who are not signed in.
const SUBMIT_ITEMS = [
  { labelKey: "events.submitEvent", href: ROUTES.EVENT_SUBMIT, Icon: Ticket },
  { labelKey: "positions.addPosition", href: ROUTES.POSITION_SUBMIT, Icon: Users },
  { labelKey: "clubs.addClub", href: ROUTES.CLUB_CREATE, Icon: Shapes },
] as const;

/** The way into every submission form: an event, a position or a club, each reviewed before it goes live. */
export function SubmissionsSection() {
  const { t } = useTranslation();
  return (
    <Section description={t("profile.submissions.description")}>
      <ItemGroup>
        {SUBMIT_ITEMS.map(({ labelKey, href, Icon }) => (
          <Item key={href} size="sm" asChild>
            <NextLink href={href}>
              <ItemMedia>
                <IconTile icon={Icon} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t(labelKey)}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </ItemActions>
            </NextLink>
          </Item>
        ))}
      </ItemGroup>
    </Section>
  );
}
