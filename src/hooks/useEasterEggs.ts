import { useState, useCallback } from "react";

export type EasterEggType = "goose" | "party" | "foodRain" | "matrix" | null;

export function useEasterEggs() {
  const [activeEasterEgg, setActiveEasterEgg] = useState<EasterEggType>(null);

  const triggerEasterEgg = useCallback((type: EasterEggType) => {
    setActiveEasterEgg(type);
  }, []);

  const clearEasterEgg = useCallback(() => {
    setActiveEasterEgg(null);
  }, []);

  const checkSearchQuery = useCallback((query: string) => {
    const lowerQuery = query.toLowerCase().trim();

    if (lowerQuery === "goose" || lowerQuery === "honk") {
      triggerEasterEgg("goose");
      return true;
    }

    if (lowerQuery === "party" || lowerQuery === "celebrate") {
      triggerEasterEgg("party");
      return true;
    }

    if (lowerQuery === "pizza" || lowerQuery === "hungry" || lowerQuery === "starving" || lowerQuery === "food") {
      triggerEasterEgg("foodRain");
      return true;
    }

    if (lowerQuery === "matrix" || lowerQuery === "neo" || lowerQuery === "red pill") {
      triggerEasterEgg("matrix");
      return true;
    }

    return false;
  }, [triggerEasterEgg]);

  return {
    activeEasterEgg,
    triggerEasterEgg,
    clearEasterEgg,
    checkSearchQuery,
  };
}
