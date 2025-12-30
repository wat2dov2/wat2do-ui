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
      {activeEasterEgg === "matrix" && <MatrixMode onComplete={onComplete} />}
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

// 🟢 Matrix Mode Easter Egg
function MatrixMode({ onComplete }: { onComplete: () => void }) {
  const [columns, setColumns] = useState<Array<{
    id: number;
    left: number;
    chars: string;
    duration: number;
    delay: number;
  }>>([]);

  useEffect(() => {
    const matrixChars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";
    const cols: typeof columns = [];

    // Create columns
    for (let i = 0; i < 30; i++) {
      let chars = "";
      const length = 10 + Math.floor(Math.random() * 20);
      for (let j = 0; j < length; j++) {
        chars += matrixChars[Math.floor(Math.random() * matrixChars.length)];
      }
      cols.push({
        id: i,
        left: (i / 30) * 100 + Math.random() * 3,
        chars,
        duration: 2 + Math.random() * 3,
        delay: Math.random() * 2,
      });
    }

    setColumns(cols);

    const timeout = setTimeout(() => {
      onComplete();
    }, 5000);

    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <>
      <div className="fixed inset-0 bg-black/80 pointer-events-none" />
      {columns.map((col) => (
        <div
          key={col.id}
          className="fixed text-green-500 font-mono text-sm whitespace-pre leading-tight"
          style={{
            left: `${col.left}%`,
            top: "-50%",
            textShadow: "0 0 10px #00ff00, 0 0 20px #00ff00",
            animation: `matrixFall ${col.duration}s linear ${col.delay}s infinite`,
            writingMode: "vertical-rl",
          }}
        >
          {col.chars}
        </div>
      ))}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-green-500 font-mono text-xl text-center">
        <div className="animate-pulse">Wake up, Neo...</div>
      </div>
      <style>{`
        @keyframes matrixFall {
          0% { transform: translateY(0); }
          100% { transform: translateY(200vh); }
        }
      `}</style>
    </>
  );
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
