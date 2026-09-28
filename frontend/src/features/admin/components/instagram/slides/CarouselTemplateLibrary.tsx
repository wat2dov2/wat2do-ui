/** Reusable artwork families. All content comes from the existing slide models. */
import type { CSSProperties, ReactNode } from "react";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type CoverSlideModel, type EventSlideModel } from "@/features/admin/lib/instagramSlides";

export const CAROUSEL_TEMPLATES = [
  { id: "signal", name: "Signal", use: "A loud, type-led roundup with one clear reason to swipe." },
  { id: "noticeboard", name: "Noticeboard", use: "A tactile campus poster collection, made for discovery." },
  { id: "editorial", name: "The Edit", use: "A restrained, magazine-like selection with room to breathe." },
  { id: "ticket", name: "Campus Pass", use: "An invitation to make plans, with details laid out like a ticket." },
] as const;
export type CarouselTemplateId = typeof CAROUSEL_TEMPLATES[number]["id"];

type Palette = { paper: string; ink: string; accent: string; accentInk: string; muted: string };
const PALETTES: Record<CarouselTemplateId, Palette> = {
  signal: { paper: "#171A16", ink: "#F8FAEE", accent: "#D8FF3E", accentInk: "#171A16", muted: "#B6BAAA" },
  noticeboard: { paper: "#EAE1CF", ink: "#27291F", accent: "#F85939", accentInk: "#FFFFFF", muted: "#676558" },
  editorial: { paper: "#F4F2EC", ink: "#172B25", accent: "#172B25", accentInk: "#F4F2EC", muted: "#66746A" },
  ticket: { paper: "#2833DB", ink: "#FFFFFF", accent: "#F6FF7C", accentInk: "#182065", muted: "#D2D6FF" },
};
const flex: CSSProperties = { display: "flex" };
const column: CSSProperties = { ...flex, flexDirection: "column" };

function Frame({ palette, children }: { palette: Palette; children: ReactNode }) {
  return <div style={{ ...column, position: "relative", width: SLIDE_WIDTH, height: SLIDE_HEIGHT, overflow: "hidden", fontFamily: "Satoshi", backgroundColor: palette.paper, color: palette.ink }}>{children}</div>;
}

function CoverHeader({ model, palette }: { model: CoverSlideModel; palette: Palette }) {
  return <div style={{ ...flex, position: "absolute", left: 64, top: 56, width: 952, alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${palette.ink}`, paddingBottom: 22 }}>
    <div style={{ ...flex, fontSize: 25, fontWeight: 700 }}>{model.dateLine}</div>
    <img src={model.logoSrc} alt="" width={74} height={74} style={{ borderRadius: 37 }} />
  </div>;
}

function CoverFooter({ model, palette }: { model: CoverSlideModel; palette: Palette }) {
  return <div style={{ ...column, position: "absolute", left: 64, bottom: 48, width: 952, gap: 20 }}>
    <div style={{ ...flex, justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${palette.ink}`, paddingTop: 22 }}>
      <div style={{ ...flex, fontSize: 31, fontWeight: 700 }}>{model.swipeLine}</div>
      <svg width="58" height="34" viewBox="0 0 58 34"><path d="M2 17h50M36 2l16 15-16 15" stroke={palette.ink} strokeWidth="4" fill="none" /></svg>
    </div>
    <div style={{ ...flex, fontSize: 23, color: palette.muted }}>{model.siteLine}</div>
  </div>;
}

function Poster({ src, width, height, style }: { src: string; width: number; height: number; style?: CSSProperties }) {
  return <div style={{ ...flex, width, height, overflow: "hidden", backgroundColor: "#FFFFFF", ...style }}>
    {src ? <img src={src} width={width} height={height} alt="" style={{ objectFit: "contain" }} /> : null}
  </div>;
}

function CoverCopy({ model, size = 100 }: { model: CoverSlideModel; size?: number }) {
  return <div style={{ ...column, gap: 24 }}>
    <div style={{ ...flex, fontWeight: 700, fontSize: size, lineHeight: 0.97, letterSpacing: -3 }}>{model.headline}</div>
    <div style={{ ...flex, fontSize: 32, lineHeight: 1.25 }}>{model.body}</div>
  </div>;
}

/** A family is one cover plus one matching event layout, never a flattened screenshot. */
export function LibraryCoverSlide({ model, template }: { model: CoverSlideModel; template: CarouselTemplateId }) {
  const palette = PALETTES[template];
  const count = String(model.newEventCount).padStart(2, "0");
  return <Frame palette={palette}>
    <CoverHeader model={model} palette={palette} />
    {template === "signal" ? <>
      <div style={{ ...flex, position: "absolute", top: 170, left: 60, fontSize: 280, lineHeight: 1, letterSpacing: -18, fontWeight: 700, color: palette.accent }}>{count}</div>
      <div style={{ ...column, position: "absolute", top: 474, left: 64, width: 850 }}><CoverCopy model={model} size={112} /></div>
      <div style={{ ...flex, position: "absolute", top: 862, left: 64, gap: 20 }}>
        {model.tiles.slice(0, 3).map((src, index) => <Poster key={index} src={src} width={294} height={244} style={{ border: `2px solid ${palette.accent}`, borderRadius: 12 }} />)}
      </div>
    </> : null}
    {template === "noticeboard" ? <>
      <div style={{ ...column, position: "absolute", left: 64, top: 190, width: 790 }}><CoverCopy model={model} size={90} /></div>
      <div style={{ ...flex, position: "absolute", left: 818, top: 189, backgroundColor: palette.accent, color: palette.accentInk, padding: "20px 24px", fontSize: 58, fontWeight: 700, transform: "rotate(8deg)" }}>{count}</div>
      {model.tiles.slice(0, 3).map((src, index) => <div key={index} style={{ ...column, position: "absolute", left: 82 + index * 277, top: 646 + (index === 1 ? -32 : 22), transform: `rotate(${[-7, 4, -3][index]}deg)`, padding: 12, backgroundColor: "#FFFFFF", boxShadow: "0 12px 20px #00000020" }}>
        <Poster src={src} width={320} height={414} />
        <div style={{ ...flex, position: "absolute", width: 106, height: 36, backgroundColor: "#C8BA97", opacity: 0.85, top: -18, left: 112, transform: "rotate(-5deg)" }} />
      </div>)}
    </> : null}
    {template === "editorial" ? <>
      <div style={{ ...flex, position: "absolute", left: 64, top: 182, width: 952, gap: 44 }}>
        <div style={{ ...column, width: 595 }}><CoverCopy model={model} size={98} /></div>
        <div style={{ ...flex, width: 313, justifyContent: "flex-end", fontSize: 160, fontWeight: 500, lineHeight: 1, letterSpacing: -10 }}>{count}</div>
      </div>
      <div style={{ ...flex, position: "absolute", left: 64, top: 666, gap: 26 }}>
        {model.tiles.slice(0, 2).map((src, index) => <Poster key={index} src={src} width={463} height={440} style={{ borderTop: `6px solid ${palette.ink}` }} />)}
      </div>
    </> : null}
    {template === "ticket" ? <>
      <div style={{ ...column, position: "absolute", left: 64, top: 191, width: 952, height: 884, backgroundColor: palette.accent, color: palette.accentInk, borderRadius: 38, padding: 48 }}>
        <div style={{ ...flex, alignItems: "center", gap: 30, marginBottom: 30 }}>
          <div style={{ ...flex, fontSize: 190, fontWeight: 700, lineHeight: 1, letterSpacing: -12 }}>{count}</div>
          <div style={{ ...flex, width: 2, height: 145, backgroundColor: palette.accentInk }} />
          <div style={{ ...flex, flex: 1, fontSize: 27, lineHeight: 1.3 }}>{model.dateLine}</div>
        </div>
        <CoverCopy model={model} size={94} />
        <div style={{ ...flex, position: "absolute", left: 48, right: 48, bottom: 48, borderTop: `3px dashed ${palette.accentInk}`, paddingTop: 30, gap: 16 }}>
          {model.tiles.slice(0, 3).map((src, index) => <Poster key={index} src={src} width={265} height={210} style={{ borderRadius: 8 }} />)}
        </div>
      </div>
    </> : null}
    <CoverFooter model={model} palette={palette} />
  </Frame>;
}

/** Poster remains complete; event facts are independent of any text baked into it. */
export function LibraryEventSlide({ model, template }: { model: EventSlideModel; template: CarouselTemplateId }) {
  const palette = PALETTES[template];
  const isTicket = template === "ticket";
  const isEditorial = template === "editorial";
  const inset = isTicket ? 72 : 56;
  const width = SLIDE_WIDTH - inset * 2;
  return <Frame palette={palette}>
    <div style={{ ...flex, position: "absolute", top: 48, left: inset, width, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ ...flex, padding: "10px 18px", backgroundColor: model.category.color, color: "#171A16", fontSize: 25, fontWeight: 700, borderRadius: isTicket ? 0 : 12 }}>{model.category.label}</div>
      <div style={{ ...flex, gap: 14, fontSize: 23 }}>{model.badges.map(badge => <div key={badge} style={flex}>{badge}</div>)}</div>
    </div>
    <Poster src={model.imageSrc} width={width} height={isEditorial ? 680 : 720} style={{ position: "absolute", top: 130, left: inset, borderRadius: isTicket ? 26 : template === "signal" ? 16 : 0, border: template === "noticeboard" ? "14px solid #FFFFFF" : "none" }} />
    <div style={{ ...column, position: "absolute", top: isEditorial ? 839 : 880, left: inset, width, borderTop: isTicket ? `3px dashed ${palette.ink}` : "none", paddingTop: isTicket ? 22 : 0, gap: 12 }}>
      <div style={{ ...flex, fontSize: model.title.length > 65 ? 43 : 54, fontWeight: 700, lineHeight: 1.03, maxHeight: 112, overflow: "hidden", letterSpacing: -1 }}>{model.title}</div>
      {model.clubLine ? <div style={{ ...flex, fontSize: 26, maxHeight: 32, overflow: "hidden", color: palette.muted }}>{model.clubLine}</div> : null}
      <div style={{ ...column, gap: 4, fontSize: 29, lineHeight: 1.2, marginTop: 10 }}>
        <div style={{ ...flex, fontWeight: 700 }}>{model.dateLine}</div>
        <div style={flex}>{model.timeLine}</div>
        <div style={{ ...flex, maxHeight: 36, overflow: "hidden", color: palette.muted }}>{model.location}</div>
      </div>
    </div>
    <div style={{ ...flex, position: "absolute", left: inset, bottom: 38, width, paddingTop: 17, borderTop: `1px solid ${palette.muted}`, fontSize: 21, color: palette.muted }}>{model.addedLine}</div>
  </Frame>;
}
