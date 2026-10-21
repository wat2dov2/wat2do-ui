"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LandingRedacted } from "@/features/landing/components/LandingRedacted";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Download,
  Eye,
  Grid3x3,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "@/shared/ui/doodle-icons";

/**
 * A simplified, animated picture of how a club's post becomes a listing.
 * Club accounts notify a step we keep private (drawn redacted), which hands
 * each post to the Mac mini's browser worker, which passes it to the fetcher to read; Claude agents read
 * the flyer, and the event lands in the database behind the feed. Beneath the
 * Mac mini, the on-call row: the browser worker pages a personal phone when it
 * needs help, and the laptop reaches back into it to fix things.
 */

const NODES = {
  accounts: { x: 25, y: 78, w: 200, h: 92 },
  relay: { x: 25, y: 244, w: 200, h: 92 },
  browser: { x: 290, y: 78, w: 200, h: 92 },
  fetcher: { x: 510, y: 78, w: 205, h: 92 },
  agents: { x: 510, y: 244, w: 205, h: 112 },
  database: { x: 775, y: 78, w: 200, h: 92 },
  feed: { x: 775, y: 244, w: 200, h: 92 },
  pager: { x: 290, y: 410, w: 205, h: 80 },
  laptop: { x: 510, y: 410, w: 205, h: 80 },
} as const;

type NodeKey = keyof typeof NODES;

/** Each wire carries posts one way; dots run along it on staggered loops. */
const WIRES: readonly { id: string; d: string; tone: string; seconds: number; dots: number }[] = [
  { id: "accounts-relay", d: "M125 170 V244", tone: "var(--pink-500)", seconds: 2.2, dots: 2 },
  { id: "relay-browser", d: "M225 276 C 262 276, 262 140, 290 140", tone: "var(--blue-500)", seconds: 2.6, dots: 1 },
  { id: "browser-fetcher", d: "M490 124 H510", tone: "var(--pink-500)", seconds: 1.4, dots: 1 },
  { id: "fetcher-agents", d: "M612 170 V244", tone: "var(--amber-400)", seconds: 2, dots: 2 },
  { id: "agents-database", d: "M715 300 C 750 300, 740 124, 775 124", tone: "var(--green-500)", seconds: 2.6, dots: 2 },
  { id: "database-feed", d: "M875 170 V244", tone: "var(--green-500)", seconds: 2, dots: 1 },
  // On call: the browser worker pages the personal phone when it needs help,
  // and the laptop reaches back into the browser worker to fix it.
  { id: "browser-pager", d: "M390 170 V410", tone: "var(--orange-500)", seconds: 2.4, dots: 1 },
  { id: "laptop-browser", d: "M510 450 H500 V150 H490", tone: "var(--blue-500)", seconds: 2.8, dots: 1 },
];

const AGENT_SLOTS = 8;
const ICON_SIZE = 34;

function PipelineNode({ node, title, note, accent, Icon, redacted = false }: {
  node: NodeKey;
  title: ReactNode;
  /** Blur the whole node, box and icon included, for a step we keep private. */
  redacted?: boolean;
  /** A short clarification printed small under the title. */
  note?: string;
  accent: string;
  Icon: LucideIcon;
}) {
  const { x, y, w, h } = NODES[node];
  return (
    <g filter={redacted ? "url(#pipeline-redact)" : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={12} className="fill-surface" stroke={accent} strokeWidth={1.5} />
      <rect x={x + 14} y={y + (h - 52) / 2} width={52} height={52} rx={12} fill={accent} opacity={0.14} />
      <Icon x={x + 23} y={y + (h - ICON_SIZE) / 2} width={ICON_SIZE} height={ICON_SIZE} style={{ color: accent }} aria-hidden="true" />
      {/* HTML text so long names (German compounds, Tamil) wrap inside the node, between words where possible. */}
      <foreignObject x={x + 76} y={y} width={w - 86} height={h}>
        <div className="flex h-full flex-col justify-center gap-0.5">
          <p className="line-clamp-2 text-[15px] leading-tight font-bold text-balance text-foreground [overflow-wrap:break-word]">{title}</p>
          {note ? <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{note}</p> : null}
        </div>
      </foreignObject>
    </g>
  );
}

/**
 * A shield tag straddling a node's top edge, marking the guardrails on that
 * step. It is an HTML pill in a foreignObject so it sizes to its translated
 * label and stays right-aligned to the node in every language.
 */
function GuardrailTag({ node, label, accent }: { node: NodeKey; label: string; accent: string }) {
  const { x, y, w } = NODES[node];
  return (
    <foreignObject x={x + 14} y={y - 13} width={w - 28} height={26}>
      <div className="flex h-full justify-end">
        <span
          className="flex h-full items-center gap-1.5 rounded-full border-[1.5px] bg-surface px-2.5 text-[11px] font-bold whitespace-nowrap"
          style={{ borderColor: accent, color: accent }}
        >
          <Shield width={14} height={14} aria-hidden="true" />
          {label}
        </span>
      </div>
    </foreignObject>
  );
}

export function LandingPipelineDiagram() {
  const { t } = useTranslation();
  const agents = NODES.agents;

  return (
    <svg viewBox="0 0 1000 515" role="img" aria-label={t("landing.different.diagramLabel")} className="h-auto w-full">
      <defs>
        <filter id="pipeline-redact" x="-15%" y="-25%" width="130%" height="150%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        {WIRES.map(({ id, d }) => <path key={id} id={`pipeline-wire-${id}`} d={d} />)}
      </defs>

      {/* The three places the work happens. */}
      <g className="fill-muted/40 stroke-border" strokeWidth={1}>
        <rect x={10} y={20} width={230} height={340} rx={16} />
        <rect x={270} y={20} width={460} height={340} rx={16} />
        <rect x={760} y={20} width={230} height={340} rx={16} />
        <rect x={270} y={372} width={460} height={132} rx={16} />
      </g>
      <g className="fill-muted-foreground text-[11px] font-bold uppercase tracking-[0.14em]">
        <text x={26} y={48}>{t("landing.different.diagram.zoneInstagram")}</text>
        <text x={286} y={48}>{t("landing.different.diagram.zoneMac")}</text>
        <text x={776} y={48}>{t("landing.different.diagram.zoneWat2do")}</text>
        <text x={286} y={398}>{t("landing.different.diagram.zoneOnCall")}</text>
      </g>

      <g fill="none" className="stroke-border" strokeWidth={2} strokeDasharray="4 6">
        {WIRES.map(({ id, d }) => <path key={id} d={d} />)}
      </g>

      <PipelineNode node="accounts" title={t("landing.different.diagram.accounts")} accent="var(--pink-500)" Icon={Users} />
      <PipelineNode node="relay" redacted title={<LandingRedacted />} accent="var(--blue-500)" Icon={Bell} />
      <PipelineNode node="browser" title={t("landing.different.diagram.browser")} accent="var(--pink-500)" Icon={Eye} />
      <PipelineNode node="fetcher" title={t("landing.different.diagram.fetcher")} accent="var(--pink-500)" Icon={Download} />
      <PipelineNode node="database" title={t("landing.different.diagram.database")} accent="var(--green-500)" Icon={CalendarDays} />
      <PipelineNode node="feed" title={t("landing.different.diagram.feed")} accent="var(--green-500)" Icon={Grid3x3} />
      <PipelineNode node="laptop" title={t("landing.different.diagram.laptop")} note={t("landing.different.diagram.laptopNote")} accent="var(--blue-500)" Icon={Settings} />
      <PipelineNode node="pager" title={t("landing.different.diagram.pager")} accent="var(--orange-500)" Icon={AlertTriangle} />

      {/* The agents' node is drawn as its eight slots, lighting up in turn as posts are read in parallel. */}
      <g>
        <rect x={agents.x} y={agents.y} width={agents.w} height={agents.h} rx={12} className="fill-surface" stroke="var(--amber-400)" strokeWidth={1.5} />
        <foreignObject x={agents.x + 18} y={agents.y + 16} width={agents.w - 36} height={28}>
          <p className="truncate text-[15px] leading-7 font-bold text-foreground">{t("landing.different.diagram.agents")}</p>
        </foreignObject>
        {Array.from({ length: AGENT_SLOTS }, (_, index) => (
          <circle
            key={index}
            cx={agents.x + 26 + index * 22}
            cy={agents.y + 74}
            r={8}
            fill="var(--amber-400)"
            opacity={0.2}
          >
            <animate
              attributeName="opacity"
              values="0.2;1;1;0.2"
              keyTimes="0;0.15;0.6;1"
              dur="3.2s"
              begin={`${(index * 0.37) % 3.2}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </g>

      {/* Guardrails: rules on what the agents may write, and a database login that only reaches event tables. */}
      <GuardrailTag node="agents" label={t("landing.different.diagram.guardrails")} accent="var(--amber-400)" />
      <GuardrailTag node="database" label={t("landing.different.diagram.guardrails")} accent="var(--green-500)" />

      {/* Posts in flight. Hidden for people who prefer reduced motion. */}
      <g className="motion-reduce:hidden">
        {WIRES.flatMap(({ id, tone, seconds, dots }) =>
          Array.from({ length: dots }, (_, index) => (
            <circle key={`${id}-${index}`} r={5} fill={tone}>
              <animateMotion dur={`${seconds}s`} begin={`${(index * seconds) / dots}s`} repeatCount="indefinite">
                <mpath href={`#pipeline-wire-${id}`} />
              </animateMotion>
            </circle>
          )),
        )}
      </g>

      {/* Every event passes this check on its way from the agents into the database. */}
      <g>
        <circle cx={745} cy={212} r={17} className="fill-surface" stroke="var(--green-500)" strokeWidth={1.5} />
        <Shield x={735} y={202} width={20} height={20} style={{ color: "var(--green-500)" }} aria-hidden="true" />
      </g>
    </svg>
  );
}
