import React from "react";
import { SlideShell } from "../components/SlideShell";
import { EventCardPreview } from "../components/EventCardPreview";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

const flows = [
  { eyebrow: "Browse", title: "Newest events first", body: "One screen for every club." },
  { eyebrow: "Filter", title: "Search and categories", body: "Dates, price, food, and more." },
  { eyebrow: "Save", title: "Mark Interested", body: "Build a shortlist in one tap." },
  { eyebrow: "Export", title: "Add to calendar", body: "Keep your week in sync." },
];

export const SolutionOverviewSlide: React.FC<Props> = ({ events }) => {
  return (
    <SlideShell
      wave
      kicker="The product"
      title={
        <>
          One screen. Every event.{" "}
          <span style={{ color: "var(--brand-primary)" }}>Live.</span>
        </>
      }
      lede="Flexible tools for discovery—built to work together."
    >
      <BentoGrid columns={4} gap={12} style={{ flex: 1, minHeight: 0 }}>
        {flows.map((flow, index) => (
          <BentoTile
            key={flow.eyebrow}
            eyebrow={flow.eyebrow}
            title={flow.title}
            body={flow.body}
            tone={index === 0 ? "primary" : "light"}
          />
        ))}
        <BentoTile tone="surface" colSpan={2} style={{ padding: 10, minHeight: 0 }}>
          <EventCardPreview
            event={events[0]}
            caption={events[0] ? undefined : "Loading events…"}
          />
        </BentoTile>
        <BentoTile tone="surface" colSpan={2} style={{ padding: 10, minHeight: 0 }}>
          <EventCardPreview
            event={events[1]}
            caption={events[1] ? undefined : "Loading events…"}
          />
        </BentoTile>
      </BentoGrid>
    </SlideShell>
  );
};
