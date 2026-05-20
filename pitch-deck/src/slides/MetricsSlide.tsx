import React from "react";
import { SlideShell } from "../components/SlideShell";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { BentoMetricTile } from "../components/BentoMetricTile";

const topStats = [
  { value: "~2.4k", label: "Weekly visitors", estimate: true },
  { value: "~1.1k", label: "Unique students / week", estimate: true },
  { value: "~640", label: "Interest taps / week", estimate: true },
  { value: "~210", label: "I'm Going / week", estimate: true },
];

const opsStats = [
  { value: "~95", label: "QR scans at events", estimate: true },
  { value: "~180", label: "Calendar exports / week", estimate: true },
  { value: "~35", label: "Events added / day", estimate: true },
  { value: "~140", label: "Clubs with events", estimate: true },
];

const funnelRows = [
  { label: "Views", pct: 100, value: "~2.4k" },
  { label: "Interested", pct: 28, value: "~640" },
  { label: "I'm Going", pct: 12, value: "~210" },
  { label: "QR scan", pct: 5, value: "~95" },
];

const weeklyBars = [
  { label: "Mon", pct: 42 },
  { label: "Tue", pct: 58 },
  { label: "Wed", pct: 71 },
  { label: "Thu", pct: 64 },
  { label: "Fri", pct: 88 },
  { label: "Sat", pct: 52 },
  { label: "Sun", pct: 36 },
];

const Funnel: React.FC = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {funnelRows.map((row) => (
      <div
        key={row.label}
        style={{
          display: "grid",
          gridTemplateColumns: "112px 1fr 56px",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-700)" }}>
          {row.label}
        </div>
        <div
          style={{
            height: 16,
            borderRadius: "var(--radius-pill)",
            background: "rgba(15,23,42,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${row.pct}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--brand-primary), var(--brand-accent))",
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-500)", textAlign: "right" }}>
          {row.value}
        </div>
      </div>
    ))}
  </div>
);

const WeeklyBars: React.FC = () => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(7, 1fr)",
      gap: 10,
      alignItems: "end",
      minHeight: 120,
    }}
  >
    {weeklyBars.map((bar) => (
      <div
        key={bar.label}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: "100%",
            height: `${bar.pct}%`,
            minHeight: 32,
            borderRadius: "var(--radius-sm)",
            background:
              "linear-gradient(180deg, var(--brand-primary), var(--brand-accent))",
          }}
        />
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-500)" }}>
          {bar.label}
        </div>
      </div>
    ))}
  </div>
);

export const MetricsSlide: React.FC = () => {
  return (
    <SlideShell
      wave
      kicker="Proof"
      title={
        <>
          Are students{" "}
          <span style={{ color: "var(--brand-primary)" }}>showing up</span>{" "}
          because of Wat2Do?
        </>
      }
      lede="Discovery to showing up. Pilot estimates."
    >
      <BentoGrid columns={4} gap={12}>
        {topStats.map((stat) => (
          <BentoMetricTile
            key={stat.label}
            value={stat.value}
            label={stat.label}
            estimate={stat.estimate}
          />
        ))}
        {opsStats.map((stat) => (
          <BentoMetricTile
            key={stat.label}
            value={stat.value}
            label={stat.label}
            estimate={stat.estimate}
            tone="light"
          />
        ))}

        <BentoTile eyebrow="Funnel" title="Attendance funnel" colSpan={2}>
          <Funnel />
        </BentoTile>

        <BentoTile eyebrow="Reach" title="Weekly reach">
          <WeeklyBars />
        </BentoTile>

        <BentoTile eyebrow="Lift" title="Partner lift" tone="primary">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <BentoMetricTile value="~18%" label="Interest lift" estimate tone="dark" />
            <BentoMetricTile value="~12%" label="QR lift" estimate tone="dark" />
          </div>
          <ul
            style={{
              paddingLeft: 18,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 14,
              color: "rgba(255,255,255,0.9)",
              lineHeight: 1.45,
            }}
          >
            <li>Reach vs. club baseline</li>
            <li>Attendance proxy at the door</li>
            <li>Export and return rate</li>
          </ul>
        </BentoTile>
      </BentoGrid>
    </SlideShell>
  );
};
