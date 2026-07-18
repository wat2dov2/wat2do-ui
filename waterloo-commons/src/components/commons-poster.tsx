"use client";

import { forwardRef, type CSSProperties, useId } from "react";
import { BADGE_MASK_PATHS, type BadgeMaskVariant } from "../../../frontend/src/shared/ui/badge-mask-paths";
import type { CommonsPost } from "@/lib/post";

export const COMMONS_BADGE_COLORS = [
  { name: "Lime", value: "#b9f543" },
  { name: "Orange", value: "#ff5a36" },
  { name: "Blue", value: "#355cff" },
  { name: "Green", value: "#38b28b" },
  { name: "Pink", value: "#ef8bc4" },
];

interface CommonsPosterProps {
  post: CommonsPost;
  photoUrl?: string | null;
  badgeColor?: string;
  darkMode?: boolean;
  spotlight?: boolean;
}

function PosterFlorals() {
  const daisyId = `daisy-${useId().replaceAll(":", "")}`;

  return (
    <svg className="poster-florals" viewBox="0 0 490 394" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <g id={daisyId}>
          <ellipse cx="0" cy="-10" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" />
          <ellipse cx="7" cy="-7" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(45 7 -7)" />
          <ellipse cx="10" cy="0" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(90 10 0)" />
          <ellipse cx="7" cy="7" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(135 7 7)" />
          <ellipse cx="0" cy="10" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" />
          <ellipse cx="-7" cy="7" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(45 -7 7)" />
          <ellipse cx="-10" cy="0" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(90 -10 0)" />
          <ellipse cx="-7" cy="-7" rx="4.5" ry="11" fill="#faf8e8" stroke="#b8b499" strokeWidth="0.7" transform="rotate(135 -7 -7)" />
          <circle r="6.5" fill="#d8a923" />
          <circle r="3" fill="#c18c13" />
        </g>
      </defs>
      <g fill="none" stroke="#6f7436" strokeLinecap="round">
        <path d="M285 394C286 324 278 270 236 220" strokeWidth="2.3" />
        <path d="M285 394C300 311 327 252 342 187" strokeWidth="2.3" />
        <path d="M285 394C268 322 230 290 192 279" strokeWidth="2.1" />
        <path d="M285 394C293 334 364 304 391 252" strokeWidth="2" />
        <path d="M282 342C249 340 238 330 225 318" strokeWidth="1.8" />
        <path d="M294 325C323 327 339 315 353 301" strokeWidth="1.8" />
      </g>
      <g fill="#5d6933">
        <path d="M271 338c-20-17-29-10-27 0 5 12 16 13 27 0" />
        <path d="M294 348c19-14 26-6 22 3-6 10-17 10-22-3" />
        <path d="M278 369c-16-14-24-9-22 1 4 10 14 12 22-1" />
        <path d="M299 374c15-13 23-7 20 3-4 10-13 11-20-3" />
        <path d="M255 310c-16-13-24-5-20 4 5 9 14 9 20-4" />
        <path d="M315 311c16-12 23-4 18 5-6 9-15 8-18-5" />
      </g>
      <use href={`#${daisyId}`} transform="translate(236 220) scale(1.25)" />
      <use href={`#${daisyId}`} transform="translate(342 187) scale(1.12)" />
      <use href={`#${daisyId}`} transform="translate(192 279) scale(1.02)" />
      <use href={`#${daisyId}`} transform="translate(391 252) scale(1.08)" />
      <use href={`#${daisyId}`} transform="translate(270 294) scale(0.9)" />
    </svg>
  );
}

function PosterMaskCorner({ variant, className }: { variant: BadgeMaskVariant; className?: string }) {
  const { fillPath } = BADGE_MASK_PATHS[variant];

  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d={fillPath} fill="currentColor" />
    </svg>
  );
}

export const CommonsPoster = forwardRef<HTMLDivElement, CommonsPosterProps>(function CommonsPoster(
  {
    post,
    photoUrl = null,
    badgeColor = COMMONS_BADGE_COLORS[0].value,
    darkMode = false,
    spotlight = false,
  },
  ref,
) {
  const titleLength = post.title.replace(/\s/g, "").length;
  const titleClassName = titleLength > 44
    ? "poster-title is-very-long"
    : titleLength > 24
      ? "poster-title is-long"
      : "poster-title";
  const hostClassName = post.hostOrg.length > 28 ? "poster-host is-long" : "poster-host";
  const badgeClassName = spotlight && post.badge.length > 10
    ? "poster-badge is-long"
    : "poster-badge";
  const posterClassName = ["poster", darkMode ? "is-dark" : "", spotlight ? "has-spotlight" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={posterClassName}
      style={{ "--badge-color": badgeColor } as CSSProperties}
      aria-label={`Waterloo Commons post for ${post.title.replaceAll("\n", " ")}`}
    >
      <div className="poster-media">
        <div className="poster-media-clip" aria-hidden>
          <div className="poster-photo">{photoUrl && <img src={photoUrl} alt="" />}</div>
          <div className="poster-paper-layer" />
          <div className="poster-side-rule" />
          <div className="poster-blue-block" />
          <div className="poster-sun" />
          <div className="poster-dot-paper" />
          <div className="poster-ink-paper" />
          <PosterFlorals />
        </div>

        <div className="poster-badge-shell">
          <div className="poster-badge-row">
            <PosterMaskCorner variant="top-right" className="poster-badge-mask" />
            <div className="poster-badge-panel">
              <div className="poster-badge-chips">
                {spotlight && <span className="poster-spotlight-badge">SPOTLIGHT</span>}
                <span className={badgeClassName}>{post.badge}</span>
              </div>
            </div>
          </div>
          <PosterMaskCorner variant="top-right" className="poster-badge-mask poster-badge-mask-tail" />
        </div>

        <div className="poster-host-shell">
          <PosterMaskCorner variant="bottom-left" className="poster-host-mask" />
          <div className="poster-host-row">
            <div className="poster-host-panel">
              <span className={hostClassName}>{post.hostOrg}</span>
            </div>
            <PosterMaskCorner variant="bottom-left" className="poster-host-mask poster-host-mask-side" />
          </div>
        </div>
      </div>

      <div className="poster-copy">
        <span className={titleClassName}>{post.title}</span>

        <div className="poster-pills">
          {post.pills.filter(Boolean).slice(0, 5).map((pill, index) => (
            <span
              key={`${pill}-${index}`}
              className="poster-pill"
            >
              {pill}
            </span>
          ))}
        </div>
      </div>

      <div className="poster-footer">
        <div className="poster-logo-placeholder" role="img" aria-label="Waterloo Commons logo placeholder" />
        <span className="poster-venue">{post.venue}</span>
        <div className="poster-datetime">
          <span>{post.dateLine}</span>
          <span>{post.timeLine}</span>
        </div>
      </div>
    </div>
  );
});
