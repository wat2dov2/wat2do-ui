import { Section } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function CardsSection() {
  return (
    <Section
      id="cards"
      title="Cards"
      description="Surface containers for grouped content."
    >
      <ShowcaseBlock label="Card with header and content">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Campus event</CardTitle>
            <CardDescription>
              A rounded surface card using semantic tokens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Cards use bg-surface, border, and shadow-sm for elevation on dark
              backgrounds.
            </p>
            <Button size="sm">View details</Button>
          </CardContent>
        </Card>
      </ShowcaseBlock>
    </Section>
  );
}
