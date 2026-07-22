import { Section, Stack } from "@/shared/layout";
import { EmptyState, LoadingState } from "@/shared/feedback";
import { Button } from "@/shared/ui/button";
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
