import { Section, Stack } from "@/shared/layout";
import { EmptyState, LoadingState } from "@/shared/feedback";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Search } from "@/shared/ui/doodle-icons";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function FeedbackSection() {
  return (
    <Section
      id="feedback"
      title="Feedback"
      description="Empty and loading states for sections and pages."
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Alert">
          <div className="grid gap-3">
            <Alert variant="info">
              <Search />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                This informational alert uses semantic design-system tokens.
              </AlertDescription>
            </Alert>
            <Alert variant="success">
              <Search />
              <AlertTitle>All set</AlertTitle>
              <AlertDescription>Your changes were saved successfully.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <Search />
              <AlertTitle>Action needed</AlertTitle>
              <AlertDescription>Review this item before continuing.</AlertDescription>
            </Alert>
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="EmptyState">
          <EmptyState
            icon={<Search />}
            title="No events found"
            description="Try adjusting your filters or check back later for new campus events."
            action={<Button size="sm">Clear filters</Button>}
          />
        </ShowcaseBlock>

        <ShowcaseBlock label="LoadingState">
          <LoadingState label="Loading events..." />
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}
