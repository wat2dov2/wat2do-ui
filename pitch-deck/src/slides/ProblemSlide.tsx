import React from "react";
import { SlideShell } from "../components/SlideShell";
import { EventImageMosaic } from "../components/EventImageMosaic";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { BentoMetricTile } from "../components/BentoMetricTile";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

export const ProblemSlide: React.FC<Props> = ({ events }) => {
  return (
    <SlideShell
      wave
      kicker="The gap"
      title={
        <>
          Discovery on campus is{" "}
          <span style={{ color: "var(--brand-primary)" }}>broken</span>.
        </>
      }
      lede="Campus events hide in Instagram stories. Most students never see them."
      background={
        <EventImageMosaic
          events={events}
          opacity={0.18}
          overlay="linear-gradient(180deg, rgba(239,246,255,0.85) 0%, rgba(255,255,255,0.95) 100%)"
        />
      }
    >
      <BentoGrid columns={3} gap={12}>
        <BentoMetricTile value="24h" label="Typical story lifespan" />
        <BentoMetricTile value="200+" label="Posting clubs" />
        <BentoMetricTile value="0" label="Official feeds" tone="primary" />
        <BentoTile
          eyebrow="Signal"
          title="IG-only flyers"
          body="Gone in 24 hours unless you already follow the club."
          tone="surface"
        />
        <BentoTile
          eyebrow="Signal"
          title="No single feed"
          body="Every club, one place to browse."
          tone="light"
        />
        <BentoTile
          eyebrow="Student voice"
          title="Found the day before"
          body='"We met recruiters from Atlassian, Bloomberg, and Point72 from events we only found out about the day before."'
          tone="primary"
        />
      </BentoGrid>
    </SlideShell>
  );
};
