import { useId } from "react";

import { cn } from "@/shared/lib/utils";

type GooseLoadingAnimationProps = {
  className?: string;
};

export function GooseLoadingAnimation({ className }: GooseLoadingAnimationProps) {
  const svgId = useId().replace(/:/g, "");
  const paperTextureId = `paper-texture-${svgId}`;
  const watercolorId = `watercolor-${svgId}`;
  const fadeGradId = `fade-grad-${svgId}`;
  const waveMaskId = `wave-mask-${svgId}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 700"
      className={cn("h-36 w-52 sm:h-44 sm:w-64", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={paperTextureId} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves={4} result="noise" />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.05 0"
            in="noise"
            result="coloredNoise"
          />
          <feComposite in="coloredNoise" in2="SourceGraphic" operator="in" result="texture" />
          <feBlend in="SourceGraphic" in2="texture" mode="multiply" />
        </filter>

        <filter id={watercolorId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={3} result="roughness" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="roughness"
            scale={4}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="1.2" result="blurred" />
          <feComponentTransfer in="blurred" result="boosted">
            <feFuncA type="gamma" amplitude="1.3" exponent="0.85" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="boosted" mode="multiply" />
        </filter>

        <linearGradient id={fadeGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity={0} />
          <stop offset="15%" stopColor="white" stopOpacity={1} />
          <stop offset="85%" stopColor="white" stopOpacity={1} />
          <stop offset="100%" stopColor="white" stopOpacity={0} />
        </linearGradient>
        <mask id={waveMaskId}>
          <rect x="150" y="350" width="600" height="200" fill={`url(#${fadeGradId})`} />
        </mask>

        <style>
          {`
            .goose-loading-paint-multiply { mix-blend-mode: multiply; }
            .goose-loading-anim-bob {
              animation: goose-loading-bob 2s ease-in-out infinite;
              transform-origin: 450px 420px;
            }
            .goose-loading-anim-baby {
              animation: goose-loading-baby-wobble 2s ease-in-out infinite;
              transform-origin: 400px 320px;
            }
            .goose-loading-wave-left-slow { animation: goose-loading-slide-left 1.8s linear infinite; }
            .goose-loading-wave-right { animation: goose-loading-slide-right 2.2s linear infinite; }
            .goose-loading-wave-left-fast { animation: goose-loading-slide-left 1s linear infinite; }

            @keyframes goose-loading-bob {
              0%, 100% { transform: translateY(0px) rotate(0deg); }
              50% { transform: translateY(8px) rotate(-1.5deg); }
            }
            @keyframes goose-loading-baby-wobble {
              0%, 100% { transform: rotate(0deg); }
              40% { transform: rotate(4deg); }
              80% { transform: rotate(-2deg); }
            }
            @keyframes goose-loading-slide-left {
              0% { transform: translateX(0); }
              100% { transform: translateX(-200px); }
            }
            @keyframes goose-loading-slide-right {
              0% { transform: translateX(-200px); }
              100% { transform: translateX(0); }
            }
          `}
        </style>
      </defs>

      <g filter={`url(#${paperTextureId})`}>
        <g
          mask={`url(#${waveMaskId})`}
          filter={`url(#${watercolorId})`}
          className="goose-loading-paint-multiply"
        >
          <path
            className="goose-loading-wave-left-slow"
            d="M -200 425 Q -150 410 -100 425 T 0 425 T 100 425 T 200 425 T 300 425 T 400 425 T 500 425 T 600 425 T 700 425 T 800 425 T 900 425 T 1000 425 T 1100 425 T 1200 425"
            fill="none"
            stroke="#48DBFB"
            strokeWidth={6}
            strokeLinecap="round"
            opacity={0.8}
          />
          <path
            className="goose-loading-wave-right"
            d="M -200 440 Q -150 455 -100 440 T 0 440 T 100 440 T 200 440 T 300 440 T 400 440 T 500 440 T 600 440 T 700 440 T 800 440 T 900 440 T 1000 440 T 1100 440 T 1200 440"
            fill="none"
            stroke="#0ABDE3"
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.9}
          />
        </g>

        <g className="goose-loading-anim-bob">
          <ellipse
            cx="430"
            cy="455"
            rx="130"
            ry="10"
            fill="#2E86DE"
            opacity={0.25}
            filter={`url(#${watercolorId})`}
            className="goose-loading-paint-multiply"
          />

          <g filter={`url(#${watercolorId})`}>
            <path
              d="M 230 380 C 230 460, 450 490, 580 430 C 640 380, 610 270, 580 200 C 560 150, 480 160, 500 230 C 510 270, 530 320, 460 340 C 370 360, 260 340, 230 380 Z"
              fill="#C8D6E5"
              opacity={0.6}
              className="goose-loading-paint-multiply"
              transform="translate(0, 8)"
            />
            <path
              d="M 230 380 C 230 450, 450 480, 580 420 C 640 370, 610 260, 580 190 C 560 140, 480 150, 500 220 C 510 260, 530 310, 460 330 C 370 350, 260 330, 230 380 Z"
              fill="#FFFFFF"
            />
            <path
              d="M 250 370 C 220 380, 190 350, 210 330 C 190 340, 180 310, 210 300 C 230 290, 260 330, 280 350 Z"
              fill="#FFFFFF"
            />
            <path
              d="M 250 370 C 220 380, 190 350, 210 330 C 190 340, 180 310, 210 300 C 230 290, 260 330, 280 350 Z"
              fill="#C8D6E5"
              opacity={0.6}
              className="goose-loading-paint-multiply"
              transform="translate(3, 5)"
            />
          </g>

          <g className="goose-loading-anim-baby" filter={`url(#${watercolorId})`}>
            <ellipse cx="380" cy="335" rx="35" ry="15" fill="#C8D6E5" opacity={0.7} className="goose-loading-paint-multiply" />
            <ellipse cx="380" cy="315" rx="35" ry="25" fill="#FEEAA0" />
            <ellipse
              cx="380"
              cy="315"
              rx="35"
              ry="25"
              fill="#F9CA24"
              opacity={0.4}
              className="goose-loading-paint-multiply"
              transform="translate(-3, 4)"
            />
            <circle cx="410" cy="275" r="28" fill="#FEEAA0" />
            <circle
              cx="410"
              cy="275"
              r="28"
              fill="#F9CA24"
              opacity={0.3}
              className="goose-loading-paint-multiply"
              transform="translate(-2, 3)"
            />
            <path d="M 395 250 Q 405 235 415 242 Q 410 250 405 250 Z" fill="#FEEAA0" />
            <path d="M 432 278 Q 455 275 450 285 Q 430 288 432 278 Z" fill="#FF9F43" />
            <path
              d="M 440 279 Q 445 277 448 280"
              fill="none"
              stroke="#E67E22"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <ellipse cx="422" cy="268" rx="5" ry="9" fill="#2D3436" />
            <circle cx="423" cy="264" r="2.5" fill="#FFFFFF" />
            <circle cx="419" cy="271" r="1" fill="#FFFFFF" />
            <circle cx="430" cy="283" r="6" fill="#FF7675" opacity={0.45} className="goose-loading-paint-multiply" />
          </g>

          <g filter={`url(#${watercolorId})`}>
            <path d="M 575 175 Q 630 170 640 195 Q 610 205 570 195 Z" fill="#FF9F43" />
            <path
              d="M 575 175 Q 630 170 640 195 Q 610 205 570 195 Z"
              fill="#E67E22"
              opacity={0.5}
              className="goose-loading-paint-multiply"
              transform="translate(0, 3)"
            />
            <path
              d="M 570 190 Q 565 195 565 202"
              fill="none"
              stroke="#E67E22"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <path
              d="M 575 178 Q 610 175 630 185"
              fill="none"
              stroke="#FEEAA0"
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.8}
            />
            <ellipse cx="555" cy="165" rx="6" ry="11" fill="#2D3436" transform="rotate(10 555 165)" />
            <circle cx="557" cy="159" r="3" fill="#FFFFFF" />
            <circle cx="552" cy="170" r="1.5" fill="#FFFFFF" />
            <path
              d="M 552 155 Q 565 145 572 148"
              fill="none"
              stroke="#2D3436"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <path
              d="M 558 160 Q 568 152 575 156"
              fill="none"
              stroke="#2D3436"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <ellipse
              cx="545"
              cy="188"
              rx="10"
              ry="6"
              fill="#FF7675"
              opacity={0.35}
              className="goose-loading-paint-multiply"
              transform="rotate(-10 545 188)"
            />
            <path
              d="M 480 300 C 510 330, 490 380, 440 395 C 430 400, 410 395, 420 380 C 390 390, 370 385, 380 365 C 350 370, 330 355, 350 335 C 390 330, 440 290, 480 300 Z"
              fill="#C8D6E5"
              opacity={0.85}
              className="goose-loading-paint-multiply"
              transform="translate(-4, 6)"
            />
            <path
              d="M 480 300 C 510 330, 490 380, 440 395 C 430 400, 410 395, 420 380 C 390 390, 370 385, 380 365 C 350 370, 330 355, 350 335 C 390 330, 440 290, 480 300 Z"
              fill="#FFFFFF"
            />
            <path
              d="M 450 330 Q 440 370 425 385"
              fill="none"
              stroke="#C8D6E5"
              strokeWidth={2.5}
              strokeLinecap="round"
              opacity={0.7}
            />
            <path
              d="M 425 325 Q 410 355 385 370"
              fill="none"
              stroke="#C8D6E5"
              strokeWidth={2.5}
              strokeLinecap="round"
              opacity={0.6}
            />
          </g>
        </g>

        <g
          mask={`url(#${waveMaskId})`}
          filter={`url(#${watercolorId})`}
          className="goose-loading-paint-multiply"
        >
          <path
            className="goose-loading-wave-left-fast"
            d="M -200 455 Q -150 435 -100 455 T 0 455 T 100 455 T 200 455 T 300 455 T 400 455 T 500 455 T 600 455 T 700 455 T 800 455 T 900 455 T 1000 455 T 1100 455 T 1200 455"
            fill="none"
            stroke="#2E86DE"
            strokeWidth={8}
            strokeLinecap="round"
            opacity={0.95}
          />
        </g>

        <g filter={`url(#${watercolorId})`} opacity={0.9} className="goose-loading-paint-multiply">
          <circle cx="680" cy="465" r="4.5" fill="#0ABDE3" />
          <circle cx="700" cy="445" r="2.5" fill="#48DBFB" />
          <circle cx="260" cy="475" r="5.5" fill="#2E86DE" />
          <circle cx="235" cy="440" r="3" fill="#0ABDE3" />
          <circle cx="740" cy="475" r="3.5" fill="#2E86DE" opacity={0.8} />
          <circle cx="205" cy="465" r="3.5" fill="#48DBFB" opacity={0.7} />
          <path d="M 620 445 Q 615 435 625 430 Q 625 440 620 445 Z" fill="#0ABDE3" />
        </g>
      </g>
    </svg>
  );
}
