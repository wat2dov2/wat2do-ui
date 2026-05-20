import React from "react";
import { SlideShell } from "../components/SlideShell";
import { BentoGrid } from "../components/BentoGrid";
import { BentoTile } from "../components/BentoTile";
import { BentoMetricTile } from "../components/BentoMetricTile";

const BarRow: React.FC<{
  label: string;
  value: number;
  max: number;
  caption: string;
  highlight?: boolean;
}> = ({ label, value, max, caption, highlight }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        color: "var(--text-700)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ color: "var(--text-500)" }}>{caption}</span>
    </div>
    <div
      style={{
        height: 22,
        borderRadius: "var(--radius-sm)",
        background: "rgba(15,23,42,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          height: "100%",
          background: highlight
            ? "linear-gradient(90deg, var(--brand-primary), var(--brand-accent))"
            : "rgba(15,23,42,0.28)",
        }}
      />
    </div>
  </div>
);

export const ROISlide: React.FC = () => {
  return (
    <SlideShell
      wave
      kicker="The ROI"
      title={
        <>
          Discovery at{" "}
          <span style={{ color: "var(--brand-primary)" }}>cents per event</span>.
        </>
      }
      lede="Proof over promises: discovery at cents per event."
    >
      <BentoGrid columns={3} gap={12}>
        <BentoMetricTile value="~$0.04" label="Cost per event" estimate />
        <BentoMetricTile value="~10 min" label="Flyer to card" />
        <BentoMetricTile value="0 hrs" label="Club admin work" tone="primary" />
        <BentoMetricTile value="~62%" label="Club coverage" estimate />
        <BentoMetricTile value="~35" label="Events / week indexed" estimate />
        <BentoMetricTile value="~$0" label="Pilot cost" />

        <BentoTile eyebrow="Compare" title="Cost per event discovered" colSpan={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
            <BarRow label="Manual newsletter" value={92} max={100} caption="~$3.50" />
            <BarRow label="Instagram boost" value={64} max={100} caption="~$2.20" />
            <BarRow label="Wat2Do" value={3} max={100} caption="~$0.04" highlight />
          </div>
        </BentoTile>

        <BentoTile
          eyebrow="Manifesto"
          title="One feed for every campus event."
          body="No boosted posts. No surveys. Pilot pricing: free."
          tone="primary"
        />
      </BentoGrid>
    </SlideShell>
  );
};
