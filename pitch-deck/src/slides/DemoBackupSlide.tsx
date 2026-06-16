import React from "react";
import { SlideShell } from "../components/SlideShell";
import { EventCardPreview } from "../components/EventCardPreview";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

const steps = [
  { n: 1, title: "Open feed", body: "Newest events first." },
  { n: 2, title: "Filter", body: "Free, food, categories." },
  { n: 3, title: "Save", body: "Mark Interested." },
  { n: 4, title: "Calendar", body: "Export your week." },
  { n: 5, title: "Submit", body: "Add a flyer we missed." },
];

export const DemoBackupSlide: React.FC<Props> = ({ events }) => {
  const previews = events.slice(6, 10);

  return (
    <SlideShell
      wave
      kicker="Backup demo"
      title={
        <>
          If live demo fails,{" "}
          <span style={{ color: "var(--brand-primary)" }}>same story</span>.
        </>
      }
      footer="wat2do.io"
    >
      <BentoGrid columns={4} gap={12} style={{ flex: 1, minHeight: 0 }}>
        <BentoTile
          eyebrow="Click-through"
          title="Walk the product"
          colSpan={2}
          rowSpan={2}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            {steps.map((step) => (
              <BentoTile
                key={step.n}
                eyebrow={`0${step.n}`}
                title={step.title}
                body={step.body}
                tone="light"
                style={{ padding: "14px 16px" }}
              />
            ))}
          </div>
        </BentoTile>

        {previews.map((ev) => (
          <BentoTile key={ev.id} tone="surface" style={{ padding: 10, minHeight: 0 }}>
            <EventCardPreview event={ev} />
          </BentoTile>
        ))}
        {previews.length < 4 &&
          Array.from({ length: 4 - previews.length }).map((_, i) => (
            <BentoTile key={`p-${i}`} tone="surface" style={{ padding: 10, minHeight: 0 }}>
              <EventCardPreview caption="Demo screenshot" />
            </BentoTile>
          ))}
      </BentoGrid>
    </SlideShell>
  );
};
