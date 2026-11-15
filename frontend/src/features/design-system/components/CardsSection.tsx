import { Section } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { StatCard } from "@/shared/ui/stat-card";
import { DateTile, IconTile } from "@/shared/ui/tile";
import { Ticket } from "lucide-react";
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
      <ShowcaseBlock label="Stat card">
        <div className="max-w-xs">
          <StatCard icon={Ticket} label="Tickets" value="128" note="Updated just now" />
        </div>
      </ShowcaseBlock>
      <ShowcaseBlock label="Item group: one list on one surface, hairlines between rows, led by a date or icon tile">
        <ItemGroup className="max-w-md">
          <Item size="sm">
            <ItemMedia>
              <DateTile dtstartUtc="2026-11-20T23:00:00Z" locale="en" timeZone="America/Toronto" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Board Game Social</ItemTitle>
              <ItemDescription>Fri, Nov 20, 6:00 PM · SLC Great Hall</ItemDescription>
            </ItemContent>
          </Item>
          <Item size="sm">
            <ItemMedia>
              <IconTile icon={Ticket} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Add event</ItemTitle>
            </ItemContent>
          </Item>
        </ItemGroup>
      </ShowcaseBlock>
    </Section>
  );
}
