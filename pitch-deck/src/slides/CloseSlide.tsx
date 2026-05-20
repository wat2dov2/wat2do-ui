import React from "react";
import { SlideShell } from "../components/SlideShell";
import { EventImageMosaic } from "../components/EventImageMosaic";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { manifesto } from "../lib/manifesto";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

const TimelineItem: React.FC<{ when: string; what: string }> = ({
  when,
  what,
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "110px 1fr",
      gap: 12,
      alignItems: "baseline",
      padding: "7px 0",
      borderTop: "1px solid rgba(255,255,255,0.18)",
    }}
  >
    <div style={{ fontWeight: 800, fontSize: 13, opacity: 0.85 }}>{when}</div>
    <div style={{ fontSize: 13.5 }}>{what}</div>
  </div>
);

export const CloseSlide: React.FC<Props> = ({ events }) => {
  return (
    <SlideShell
      variant="dark"
      kicker="The ask"
      title={
        <>
          Run an{" "}
          <span style={{ color: "var(--brand-accent)" }}>8-week pilot</span>{" "}
          with us.
        </>
      }
      lede={manifesto.promise}
      background={
        <EventImageMosaic
          events={events}
          opacity={0.22}
          overlay="linear-gradient(180deg, rgba(11,18,32,0.78) 0%, rgba(17,24,39,0.92) 100%)"
        />
      }
      footer="Tony Qiu · Erica Han · contact@wat2do.ca · wat2do.ca"
    >
      <BentoGrid columns={2} gap={12} style={{ flex: 1, minHeight: 0 }}>
        <BentoTile
          eyebrow="The pilot"
          title="Your events on Wat2Do. QR at every event."
          body="Success = measurable lift on your events."
          tone="primary"
          colSpan={1}
        >
          <div style={{ marginTop: 4 }}>
            <TimelineItem when="Week 0" what="Scope and events to measure." />
            <TimelineItem when="Weeks 1–2" what="Live on wat2do.ca. QR posters." />
            <TimelineItem when="Weeks 3–6" what="Run. Metrics on request." />
            <TimelineItem when="Weeks 7–8" what="Report and decision." />
          </div>
        </BentoTile>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <BentoTile
            eyebrow="Next step"
            title="15 minutes this week."
            body="calendly link · contact@wat2do.ca"
            tone="surface"
          />
          {manifesto.mottoes.map((line) => (
            <BentoTile key={line} eyebrow="Manifesto" title={line} tone="dark" />
          ))}
        </div>
      </BentoGrid>
    </SlideShell>
  );
};
