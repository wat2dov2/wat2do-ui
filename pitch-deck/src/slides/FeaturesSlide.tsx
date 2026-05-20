import React from "react";
import { SlideShell } from "../components/SlideShell";
import { EventCardPreview } from "../components/EventCardPreview";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

const features = [
  { title: "Interested", body: "Save events in one tap." },
  { title: "Calendar export", body: "Keep your week in sync." },
  { title: "Student submissions", body: "Help fill the gaps." },
  { title: "QR posters", body: "Connect posters to attendance." },
  { title: "Newsletter", body: "New events without the scroll." },
  { title: "I'm Going", body: "A stronger turnout signal." },
];

export const FeaturesSlide: React.FC<Props> = ({ events }) => {
  const previews = events.slice(4, 6);

  return (
    <SlideShell
      wave
      kicker="What students get"
      title={
        <>
          Built for{" "}
          <span style={{ color: "var(--brand-primary)" }}>showing up</span>,
          not for scrolling.
        </>
      }
      lede="Each tool is a tile in the same discovery stack."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.35fr 1fr",
          gap: 12,
          flex: 1,
          minHeight: 0,
          alignItems: "stretch",
        }}
      >
        <BentoGrid columns={2} gap={12}>
          {features.map((feature, index) => (
            <BentoTile
              key={feature.title}
              eyebrow={`0${index + 1}`}
              title={feature.title}
              body={feature.body}
              tone={index % 3 === 0 ? "primary" : "light"}
            />
          ))}
        </BentoGrid>

        <BentoGrid columns={1} gap={12} style={{ minHeight: 0, height: "100%" }}>
          {previews.map((ev) => (
            <BentoTile key={ev.id} tone="surface" style={{ padding: 10, flex: 1, minHeight: 0 }}>
              <EventCardPreview event={ev} />
            </BentoTile>
          ))}
          {previews.length < 2 &&
            Array.from({ length: 2 - previews.length }).map((_, i) => (
              <BentoTile key={`p-${i}`} tone="surface" style={{ padding: 10, flex: 1, minHeight: 0 }}>
                <EventCardPreview caption="Event preview" />
              </BentoTile>
            ))}
        </BentoGrid>
      </div>
    </SlideShell>
  );
};
