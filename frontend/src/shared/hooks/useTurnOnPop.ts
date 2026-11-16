import { useState } from "react";

/**
 * Whether a toggle's icon should pop (`animate-success-pulse`): only right
 * after the person turned it on here, never when it loads already on or when a
 * failed request turns it back off. Call `press` as the toggle is pressed.
 */
export function useTurnOnPop(isOn: boolean) {
  const [pressedOn, setPressedOn] = useState(false);
  return {
    pop: pressedOn && isOn,
    press: () => setPressedOn(!isOn),
  };
}
