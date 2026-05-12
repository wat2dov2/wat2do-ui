import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { useTranslation } from "react-i18next";
import type { EasterEggType } from "@/shared/components/useEasterEggs";

// ---------------------------------------------------------------------------
// Easter egg animation timing constants (ms)
// ---------------------------------------------------------------------------
/** Delay before the goose honk visual appears. */
const HONK_DELAY_MS = 500;
/** Duration the honk visual stays visible. */
const HONK_CLEAR_DELAY_MS = 1500;
/** Duration for the confetti / celebration effect. */
const CONFETTI_DURATION_MS = 2500;
/** Duration for the rain animation effect. */
const RAIN_DURATION_MS = 4000;
/** Duration for the food rain animation effect. */
const FOOD_RAIN_DURATION_MS = 5000;
/** Duration the internal Toast component stays visible. */
const EASTER_TOAST_DURATION_MS = 2500;

interface EasterEggsProps {
  activeEasterEgg: EasterEggType;
  onComplete: () => void;
}

function readThemeColor(token: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

function getThemePalette(tokens: string[], fallback: string): string[] {
  return tokens.map((token) => readThemeColor(token, fallback));
}

export function EasterEggs({ activeEasterEgg, onComplete }: EasterEggsProps) {
  if (!activeEasterEgg) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-easter-egg">
      {activeEasterEgg === "goose" && <GooseCrossing onComplete={onComplete} />}
      {activeEasterEgg === "party" && <PartyMode onComplete={onComplete} />}
      {activeEasterEgg === "foodRain" && <FoodRain onComplete={onComplete} />}
      {activeEasterEgg === "uoft" && <UofTSpirit onComplete={onComplete} />}
      {activeEasterEgg === "mcgill" && <McGillPride onComplete={onComplete} />}
      {activeEasterEgg === "ubc" && <UBCRain onComplete={onComplete} />}
      {activeEasterEgg === "mcmaster" && <McMasterMarauder onComplete={onComplete} />}
    </div>,
    document.body
  );
}

// 🪿 Goose Crossing Easter Egg
function GooseCrossing({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(-100);
  const [honked, setHonked] = useState(false);

  useEffect(() => {
    // Play honk sound (we'll use a visual honk instead)
    const honkTimeout = setTimeout(() => setHonked(true), HONK_DELAY_MS);
    const honkClearTimeout = setTimeout(() => setHonked(false), HONK_CLEAR_DELAY_MS);

    // Animate goose walking across screen
    const interval = setInterval(() => {
      setPosition((prev) => {
        if (prev > window.innerWidth + 100) {
          clearInterval(interval);
          onComplete();
          return prev;
        }
        return prev + 4;
      });
    }, 50);

    return () => {
      clearInterval(interval);
      clearTimeout(honkTimeout);
      clearTimeout(honkClearTimeout);
    };
  }, [onComplete]);

  return (
    <>
      {/* Goose */}
      <div
        className="fixed transition-none"
        style={{
          left: position,
          bottom: "80px",
          fontSize: "48px",
          transform: "scaleX(1)",
          filter: "drop-shadow(2px 2px 4px rgba(0,0,0,0.3))",
        }}
      >
        🪿
      </div>

      {/* Honk bubble */}
      {honked && (
        <div
          className="fixed bg-background text-foreground rounded-full px-3 py-1 text-sm font-bold shadow-lg border-2 border-border"
          style={{
            left: position + 50,
            bottom: "140px",
            animation: "honkPop 600ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          HONK!
          <style>{`
            @keyframes honkPop {
              0% { transform: scale(0.85); opacity: 0; }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* Toast notification */}
      <Toast message={t("easterEggs.gooseCrossing")} />
    </>
  );
}

// 🎉 Party Mode Easter Egg
function PartyMode({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    // Fire confetti
    const duration = 3000;
    const end = Date.now() + duration;

    const colors = getThemePalette(
      [
        "--easter-party-1",
        "--easter-party-2",
        "--easter-party-3",
        "--easter-party-4",
        "--easter-party-5",
        "--easter-party-6",
      ],
      "rgb(0, 82, 255)"
    );

    // Initial burst
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors,
    });

    // Continuous confetti
    const interval = setInterval(() => {
      if (Date.now() > end) {
        clearInterval(interval);
        return;
      }

      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
    }, 250);

    // Add bounce class to event cards
    const cards = document.querySelectorAll("[data-event-card]");
    cards.forEach((card, index) => {
      const el = card as HTMLElement;
      el.style.animation = `partyBounce 0.5s ease-in-out ${index * 0.05}s 3`;
    });

    // Cleanup
    const timeout = setTimeout(() => {
      cards.forEach((card) => {
        const el = card as HTMLElement;
        el.style.animation = "";
      });
      onComplete();
    }, duration);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return (
    <>
      <Toast message={t("easterEggs.partyMode")} />
      <style>{`
        @keyframes partyBounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-10px) rotate(-2deg); }
          75% { transform: translateY(-5px) rotate(2deg); }
        }
      `}</style>
    </>
  );
}

// 🍕 Food Rain Easter Egg
function FoodRain({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [foodItems, setFoodItems] = useState<Array<{
    id: number;
    emoji: string;
    left: number;
    delay: number;
    duration: number;
  }>>([]);

  useEffect(() => {
    const emojis = ["🍕", "🍔", "🌮", "🍩", "🍟", "🌭", "🍿", "🥤", "🍪", "🎂"];
    const items: typeof foodItems = [];

    // Create 40 food items
    for (let i = 0; i < 40; i++) {
      items.push({
        id: i,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        left: Math.random() * 100,
        delay: Math.random() * 2,
        duration: 2 + Math.random() * 2,
      });
    }

    requestAnimationFrame(() => {
      setFoodItems(items);
    });

    const timeout = setTimeout(() => {
      onComplete();
    }, FOOD_RAIN_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <>
      {foodItems.map((item) => (
        <div
          key={item.id}
          className="fixed text-3xl"
          style={{
            left: `${item.left}%`,
            top: "-50px",
            animation: `foodFall ${item.duration}s linear ${item.delay}s forwards`,
          }}
        >
          {item.emoji}
        </div>
      ))}
      <Toast message={t("easterEggs.freeFood")} />
      <style>{`
        @keyframes foodFall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(calc(100vh + 100px)) rotate(360deg);
            opacity: 0.7;
          }
        }
      `}</style>
    </>
  );
}

// 🔵 UofT Spirit - Blue confetti burst
function UofTSpirit({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const colors = getThemePalette(
      ["--easter-uoft-1", "--easter-uoft-2", "--easter-uoft-3"],
      "rgb(0, 82, 255)"
    );

    // Initial burst
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors,
    });

    // More bursts
    const interval = setInterval(() => {
      confetti({
        particleCount: 30,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 30,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, CONFETTI_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message={t("easterEggs.uoftSpirit")} />;
}

// 🔴 McGill Pride - Red/white confetti
function McGillPride({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const colors = getThemePalette(
      ["--easter-mcgill-1", "--easter-mcgill-2", "--easter-mcgill-3"],
      "rgb(220, 38, 38)"
    );

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors,
    });

    const interval = setInterval(() => {
      confetti({
        particleCount: 30,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 30,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, CONFETTI_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message={t("easterEggs.mcgillPride")} />;
}

// 🌧️ UBC Rain - Vancouver rain effect
function UBCRain({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [drops, setDrops] = useState<Array<{
    id: number;
    left: number;
    delay: number;
    duration: number;
  }>>([]);

  useEffect(() => {
    const rainDrops: typeof drops = [];
    for (let i = 0; i < 60; i++) {
      rainDrops.push({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2,
        duration: 0.5 + Math.random() * 0.5,
      });
    }
    requestAnimationFrame(() => {
      setDrops(rainDrops);
    });

    const timeout = setTimeout(() => {
      onComplete();
    }, RAIN_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <>
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="fixed w-0.5 h-8 bg-linear-to-b from-transparent to-blue-400 opacity-60"
          style={{
            left: `${drop.left}%`,
            top: "-32px",
            animation: `rainFall ${drop.duration}s linear ${drop.delay}s infinite`,
          }}
        />
      ))}
      <Toast message={t("easterEggs.ubcRain")} />
      <style>{`
        @keyframes rainFall {
          0% { transform: translateY(0); opacity: 0.6; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
      `}</style>
    </>
  );
}

// 🟤 McMaster Marauder - Maroon confetti
function McMasterMarauder({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const colors = getThemePalette(
      ["--easter-mcmaster-1", "--easter-mcmaster-2", "--easter-mcmaster-3"],
      "rgb(153, 27, 27)"
    );

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors,
    });

    const interval = setInterval(() => {
      confetti({
        particleCount: 30,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 30,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, CONFETTI_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message={t("easterEggs.mcmasterMarauder")} />;
}

// Toast notification component
function Toast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), EASTER_TOAST_DURATION_MS);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-foreground text-background px-4 py-2 rounded-full shadow-lg text-sm font-medium z-max"
      style={{
        animation: "toastSlide 0.3s ease-out",
      }}
    >
      {message}
      <style>{`
        @keyframes toastSlide {
          from {
            opacity: 0;
            transform: translate(-50%, 20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </div>
  );
}

