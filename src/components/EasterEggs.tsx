import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import type { EasterEggType } from "@/hooks/useEasterEggs";

interface EasterEggsProps {
  activeEasterEgg: EasterEggType;
  onComplete: () => void;
}

// Goose sprite frames (simple pixel art representation)
const GooseFrames = [
  // Frame 1 - walking
  `
    ▄▄▄
   ▄████▄
  ▐██████▌
   ▀████▀
    ████
   ▐█  █▌
  `,
  // Frame 2 - walking
  `
    ▄▄▄
   ▄████▄
  ▐██████▌
   ▀████▀
    ████
   █▌  ▐█
  `,
];

export function EasterEggs({ activeEasterEgg, onComplete }: EasterEggsProps) {
  if (!activeEasterEgg) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[99999]">
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
  const [position, setPosition] = useState(-100);
  const [frame, setFrame] = useState(0);
  const [honked, setHonked] = useState(false);

  useEffect(() => {
    // Play honk sound (we'll use a visual honk instead)
    const honkTimeout = setTimeout(() => setHonked(true), 500);
    const honkClearTimeout = setTimeout(() => setHonked(false), 1500);

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
      setFrame((prev) => (prev + 1) % 2);
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
          className="fixed bg-white rounded-full px-3 py-1 text-sm font-bold shadow-lg animate-bounce"
          style={{
            left: position + 50,
            bottom: "140px",
            border: "2px solid #e5e7eb",
          }}
        >
          HONK!
        </div>
      )}

      {/* Toast notification */}
      <Toast message="🪿 Goose crossing!" />
    </>
  );
}

// 🎉 Party Mode Easter Egg
function PartyMode({ onComplete }: { onComplete: () => void }) {
  const [showBounce, setShowBounce] = useState(true);

  useEffect(() => {
    // Fire confetti
    const duration = 3000;
    const end = Date.now() + duration;

    const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

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
      setShowBounce(false);
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
      <Toast message="🎉 Party mode activated!" />
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

    setFoodItems(items);

    const timeout = setTimeout(() => {
      onComplete();
    }, 5000);

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
      <Toast message="🍕 Free food incoming!" />
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
  useEffect(() => {
    const colors = ["#002a5c", "#1e3d59", "#4a90d9"]; // UofT blue tones

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
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message="🔵 Go Varsity Blues!" />;
}

// 🔴 McGill Pride - Red/white confetti
function McGillPride({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const colors = ["#ed1b2f", "#ffffff", "#8b0000"]; // McGill red/white

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
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message="🔴 Allez McGill!" />;
}

// 🌧️ UBC Rain - Vancouver rain effect
function UBCRain({ onComplete }: { onComplete: () => void }) {
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
    setDrops(rainDrops);

    const timeout = setTimeout(() => {
      onComplete();
    }, 4000);

    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <>
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="fixed w-0.5 h-8 bg-gradient-to-b from-transparent to-blue-400 opacity-60"
          style={{
            left: `${drop.left}%`,
            top: "-32px",
            animation: `rainFall ${drop.duration}s linear ${drop.delay}s infinite`,
          }}
        />
      ))}
      <Toast message="🌧️ Vancouver vibes! Go Thunderbirds!" />
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
  useEffect(() => {
    const colors = ["#7a003c", "#ffc72c", "#5c002e"]; // McMaster maroon/gold

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
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [onComplete]);

  return <Toast message="🟤 Go Marauders!" />;
}

// Toast notification component
function Toast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-[100000]"
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

export default EasterEggs;
