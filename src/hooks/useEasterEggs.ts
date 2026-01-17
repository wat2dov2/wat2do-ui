import { useState, useCallback } from "react";

export type EasterEggType = "goose" | "party" | "foodRain" | "uoft" | "mcgill" | "ubc" | "mcmaster" | null;

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

    // University of Waterloo (goose is the mascot)
    if (lowerQuery === "goose" || lowerQuery === "honk" || lowerQuery === "waterloo" || lowerQuery === "uwaterloo") {
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

    // University of Toronto
    if (lowerQuery === "toronto" || lowerQuery === "uoft" || lowerQuery === "u of t" || lowerQuery === "varsity") {
      triggerEasterEgg("uoft");
      return true;
    }

    // McGill University
    if (lowerQuery === "mcgill" || lowerQuery === "montreal" || lowerQuery === "martlets") {
      triggerEasterEgg("mcgill");
      return true;
    }

    // University of British Columbia
    if (lowerQuery === "ubc" || lowerQuery === "vancouver" || lowerQuery === "thunderbirds") {
      triggerEasterEgg("ubc");
      return true;
    }

    // McMaster University
    if (lowerQuery === "mcmaster" || lowerQuery === "hamilton" || lowerQuery === "marauders") {
      triggerEasterEgg("mcmaster");
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
