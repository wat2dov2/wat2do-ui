import React from "react";
import { SlideShell } from "../components/SlideShell";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { manifesto } from "../lib/manifesto";

export const ManifestoSlide: React.FC = () => {
  return (
    <SlideShell
      wave
      kicker="Manifesto"
      title={
        <>
          {manifesto.tagline}{" "}
          <span style={{ color: "var(--brand-primary)" }}>Built for showing up.</span>
        </>
      }
      lede={manifesto.promise}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
        <BentoGrid columns={3} gap={12}>
          {manifesto.pillars.map((pillar, index) => (
            <BentoTile
              key={pillar.id}
              eyebrow={`0${index + 1}`}
              title={pillar.title}
              body={pillar.body}
              tone={index === 2 || index === 4 ? "primary" : "surface"}
            />
          ))}
        </BentoGrid>

        <BentoGrid columns={3} gap={10} style={{ marginTop: "auto" }}>
          {manifesto.mottoes.map((line) => (
            <BentoTile key={line} eyebrow="Manifesto" title={line} tone="light" />
          ))}
        </BentoGrid>
      </div>
    </SlideShell>
  );
};
