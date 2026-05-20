import React from "react";
import { EventImageMosaic } from "../components/EventImageMosaic";
import { Chip } from "../components/Chip";
import { BrandWave } from "../components/BrandWave";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { BentoMetricTile } from "../components/BentoMetricTile";
import { impactMetrics, manifesto } from "../lib/manifesto";
import type { EventImage } from "../lib/types";

interface Props {
  events: EventImage[];
}

const quickTiles = [
  { title: "Filter events", body: "Search, categories, dates." },
  { title: "Save favorites", body: "Mark Interested in one tap." },
  { title: "Export to calendar", body: "Keep your week in sync." },
];

export const TitleSlide: React.FC<Props> = ({ events }) => {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--grad-light)",
        overflow: "hidden",
      }}
    >
      <BrandWave />
      <EventImageMosaic
        events={events}
        layout="scatter"
        opacity={0.45}
        overlay="linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(239,246,255,0.88) 100%)"
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          maxWidth: "var(--slide-max-width)",
          margin: "0 auto",
          padding: "56px 64px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src="/wat2do-logo.svg"
            alt="Wat2Do"
            style={{ width: 44, height: 44 }}
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>Wat2Do</div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--brand-primary)",
                marginTop: 4,
              }}
            >
              {manifesto.tagline}
            </div>
          </div>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <Chip tone="live">Events added in real time · wat2do.ca</Chip>
          <h1
            style={{
              fontSize: "clamp(44px, 6.4vw, 92px)",
              lineHeight: 0.98,
              letterSpacing: "-0.03em",
              maxWidth: 1080,
            }}
          >
            {manifesto.promise}
          </h1>
          <p
            style={{
              fontSize: "clamp(16px, 1.45vw, 21px)",
              color: "var(--text-700)",
              maxWidth: 720,
            }}
          >
            Student-led pilot at UWaterloo. Built by students. Supported by SLEF.
          </p>

          <BentoGrid columns={3} gap={10}>
            {quickTiles.map((tile, index) => (
              <BentoTile
                key={tile.title}
                eyebrow={`0${index + 1}`}
                title={tile.title}
                body={tile.body}
                tone={index === 0 ? "primary" : "light"}
              />
            ))}
          </BentoGrid>

          <BentoGrid columns={4} gap={10}>
            {impactMetrics.map((metric) => (
              <BentoMetricTile
                key={String(metric.label)}
                value={metric.value}
                label={metric.label}
                estimate={"estimate" in metric ? metric.estimate : false}
              />
            ))}
          </BentoGrid>
        </div>

        <footer style={{ color: "var(--text-500)", fontSize: 14 }}>
          Tony Qiu · Erica Han · contact@wat2do.ca
        </footer>
      </div>
    </div>
  );
};
