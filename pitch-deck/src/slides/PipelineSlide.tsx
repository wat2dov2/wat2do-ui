import React from "react";
import { SlideShell } from "../components/SlideShell";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";

const steps = [
  { n: "01", title: "Collect", body: "New club posts, pulled in." },
  { n: "02", title: "Read the flyer", body: "Time, place, and price on one card." },
  { n: "03", title: "Verify", body: "Real events only." },
  { n: "04", title: "Publish", body: "On wat2do.io within minutes." },
];

export const PipelineSlide: React.FC = () => {
  return (
    <SlideShell
      wave
      kicker="How it works"
      title={
        <>
          Flyer to filterable card in{" "}
          <span style={{ color: "var(--brand-primary)" }}>about 10 minutes</span>.
        </>
      }
      lede="Live by default. Clubs change nothing. Students get a feed."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BentoGrid columns={4} gap={12}>
          {steps.map((step) => (
            <BentoTile
              key={step.n}
              eyebrow={step.n}
              title={step.title}
              body={step.body}
              tone="surface"
            />
          ))}
        </BentoGrid>

        <BentoTile
          eyebrow="Manifesto"
          title="Clarity over noise"
          body="One feed for every campus event. No boosted posts. No surveys."
          tone="primary"
        />
      </div>
    </SlideShell>
  );
};
