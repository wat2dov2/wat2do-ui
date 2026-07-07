import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface OrganizationCardFrameDimensions {
  w: number;
  h: number;
  cw: number;
  ch: number;
}

interface OrganizationCardFramePaths {
  borderOuter: string;
  borderCutout: string;
  clip: string;
}

const EMPTY_FRAME_PATHS: OrganizationCardFramePaths = { borderOuter: "", borderCutout: "", clip: "" };

function getOrganizationCardFramePaths({
  w,
  h,
  cw,
  ch,
}: OrganizationCardFrameDimensions): OrganizationCardFramePaths {
  if (w === 0 || h === 0) return EMPTY_FRAME_PATHS;

  const cardRadius = 12;
  const cutoutRadius = 8;
  const gap = 4;
  const cutoutWidth = cw > 0 ? cw + gap : 0;
  const cutoutHeight = ch > 0 ? ch + gap : 0;

  if (cutoutWidth === 0 || cutoutHeight === 0) {
    const standardPath = `M ${cardRadius} 0 L ${w - cardRadius} 0 A ${cardRadius} ${cardRadius} 0 0 1 ${w} ${cardRadius} L ${w} ${h - cardRadius} A ${cardRadius} ${cardRadius} 0 0 1 ${w - cardRadius} ${h} L ${cardRadius} ${h} A ${cardRadius} ${cardRadius} 0 0 1 0 ${h - cardRadius} L 0 ${cardRadius} A ${cardRadius} ${cardRadius} 0 0 1 ${cardRadius} 0 Z`;
    return { borderOuter: standardPath, borderCutout: "", clip: standardPath };
  }

  const offset = 0.75;
  const borderWidth = w - offset;
  const borderHeight = h - offset;
  const borderCutoutWidth = cutoutWidth - offset;
  const borderCutoutHeight = cutoutHeight - offset;

  const borderOuter = `M ${borderCutoutWidth + cutoutRadius} ${offset} L ${borderWidth - cardRadius} ${offset} A ${cardRadius} ${cardRadius} 0 0 1 ${borderWidth} ${cardRadius} L ${borderWidth} ${borderHeight - cardRadius} A ${cardRadius} ${cardRadius} 0 0 1 ${borderWidth - cardRadius} ${borderHeight} L ${cardRadius} ${borderHeight} A ${cardRadius} ${cardRadius} 0 0 1 ${offset} ${borderHeight - cardRadius} L ${offset} ${borderCutoutHeight + cutoutRadius}`;
  const borderCutout = `M ${offset} ${borderCutoutHeight + cutoutRadius} A ${cutoutRadius} ${cutoutRadius} 0 0 1 ${cutoutRadius + offset} ${borderCutoutHeight} L ${borderCutoutWidth - cutoutRadius} ${borderCutoutHeight} A ${cutoutRadius} ${cutoutRadius} 0 0 0 ${borderCutoutWidth} ${borderCutoutHeight - cutoutRadius} L ${borderCutoutWidth} ${cutoutRadius + offset} A ${cutoutRadius} ${cutoutRadius} 0 0 1 ${borderCutoutWidth + cutoutRadius} ${offset}`;
  const clipPath = `M ${cutoutWidth + cutoutRadius} 0 L ${w - cardRadius} 0 A ${cardRadius} ${cardRadius} 0 0 1 ${w} ${cardRadius} L ${w} ${h - cardRadius} A ${cardRadius} ${cardRadius} 0 0 1 ${w - cardRadius} ${h} L ${cardRadius} ${h} A ${cardRadius} ${cardRadius} 0 0 1 0 ${h - cardRadius} L 0 ${cutoutHeight + cutoutRadius} A ${cutoutRadius} ${cutoutRadius} 0 0 1 ${cutoutRadius} ${cutoutHeight} L ${cutoutWidth - cutoutRadius} ${cutoutHeight} A ${cutoutRadius} ${cutoutRadius} 0 0 0 ${cutoutWidth} ${cutoutHeight - cutoutRadius} L ${cutoutWidth} ${cutoutRadius} A ${cutoutRadius} ${cutoutRadius} 0 0 1 ${cutoutWidth + cutoutRadius} 0 Z`;

  return { borderOuter, borderCutout, clip: clipPath };
}

export function useOrganizationCardFrame() {
  const cardRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<OrganizationCardFrameDimensions>({
    w: 0,
    h: 0,
    cw: 0,
    ch: 0,
  });

  useSafeLayoutEffect(() => {
    const cardEl = cardRef.current;
    const badgeEl = badgeRef.current;
    if (!cardEl) return;

    const updateDimensions = () => {
      setDimensions({
        w: cardEl.offsetWidth,
        h: cardEl.offsetHeight,
        cw: badgeEl ? badgeEl.offsetWidth : 0,
        ch: badgeEl ? badgeEl.offsetHeight : 0,
      });
    };

    updateDimensions();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(cardEl);
    if (badgeEl) observer.observe(badgeEl);

    return () => observer.disconnect();
  }, []);

  const paths = useMemo(
    () => getOrganizationCardFramePaths(dimensions),
    [dimensions],
  );

  return { cardRef, badgeRef, paths };
}
