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

export const MarketSlide: React.FC<Props> = ({ events }) => {
  return (
    <SlideShell
      wave
      kicker="The campus"
      title={
        <>
          One campus.{" "}
          <span style={{ color: "var(--brand-primary)" }}>
            ~42,000 students.
          </span>{" "}
          Hundreds of clubs.
        </>
      }
      background={
        <EventImageMosaic
          events={events}
          opacity={0.16}
          overlay="linear-gradient(180deg, rgba(239,246,255,0.9) 0%, rgba(255,255,255,0.96) 100%)"
        />
      }
    >
      <BentoGrid columns={4} gap={12}>
        <BentoMetricTile value="42,000+" label="UWaterloo students" />
        <BentoMetricTile value="200+" label="Campus clubs" />
        <BentoMetricTile value="10,000+" label="Events indexed" />
        <BentoMetricTile value="~2.4k" label="Weekly visitors" estimate />
        <BentoTile
          eyebrow="Wedge"
          title="Why UWaterloo first"
          body="We are students here. We know the clubs and the flyers."
          tone="light"
          colSpan={2}
        />
        <BentoTile
          eyebrow="Timing"
          title="Why now"
          body="Students are already scrolling. The gap is one trusted feed."
          tone="surface"
        />
        <BentoTile
          eyebrow="Pilot"
          title="Proof over promises"
          body="Start with one campus. Prove lift. Expand from there."
          tone="primary"
        />
      </BentoGrid>
    </SlideShell>
  );
};
