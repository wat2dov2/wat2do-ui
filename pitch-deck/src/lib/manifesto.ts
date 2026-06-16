type ManifestoPillar = {
  id: string;
  title: string;
  body: string;
};

export const manifesto = {
  tagline: "Discovery infrastructure for campus life.",
  promise:
    "One trusted feed so every student finds what matters before it's over.",
  pillars: [
    {
      id: "feed",
      title: "One trusted feed",
      body: "Every club event in one place—not buried in stories.",
    },
    {
      id: "live",
      title: "Live by default",
      body: "New posts become filterable cards within minutes.",
    },
    {
      id: "show-up",
      title: "Built for showing up",
      body: "Interest, calendar, and QR tie discovery to turnout.",
    },
    {
      id: "students",
      title: "Students first",
      body: "Built at UWaterloo by students who run clubs.",
    },
    {
      id: "proof",
      title: "Proof over promises",
      body: "Measure lift on real events in a pilot.",
    },
    {
      id: "clarity",
      title: "Clarity over noise",
      body: "Plain language. No jargon. No extra work for clubs.",
    },
  ] satisfies ManifestoPillar[],
  mottoes: [
    "Walk the campus like a student.",
    "Fight the pull toward mediocre discovery.",
    "Trust is earned with every card.",
  ],
} as const;

export const impactMetrics = [
  { value: "10,000+", label: "Events indexed" },
  { value: "200+", label: "Campus clubs" },
  { value: "~10 min", label: "Flyer to live card" },
  { value: "~2.4k", label: "Weekly visitors", estimate: true },
] as const;
