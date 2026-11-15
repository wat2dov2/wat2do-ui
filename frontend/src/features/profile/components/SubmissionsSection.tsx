import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { Shapes, Ticket, Users } from "lucide-react";
import { ROUTES } from "@/shared/constants/routes";
import { Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

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
    <Section title={t("profile.submissions.title")} description={t("profile.submissions.description")}>
      <Stack direction="horizontal" gap={2} wrap>
        {SUBMIT_ITEMS.map(({ labelKey, href, Icon }) => (
          <Button key={href} asChild variant="outline" size="sm">
            <NextLink href={href}>
              <Icon />
              {t(labelKey)}
            </NextLink>
          </Button>
        ))}
      </Stack>
    </Section>
  );
}
