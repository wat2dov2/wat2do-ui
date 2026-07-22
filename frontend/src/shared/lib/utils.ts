import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `bg-page-dots` and `bg-page-glow` are custom utilities that set
 * `background-image`, not `background-color` (see index.css). Stock
 * tailwind-merge groups anything matching `bg-*` with background colours, so on
 * an element carrying both it silently drops one - e.g. `bg-background
 * bg-page-dots` would lose the dots. Registering them as their own group keeps
 * the colour and the decoration together.
 */
const twMerge = extendTailwindMerge<"bg-decoration">({
  extend: {
    classGroups: {
      "bg-decoration": ["bg-page-dots", "bg-page-glow"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
