import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `bg-page-glow` is a custom utility that sets `background-image`, not
 * `background-color` (see index.css). Registering it separately keeps
 * tailwind-merge from treating it as a competing background colour.
 */
const twMerge = extendTailwindMerge<"bg-decoration">({
  extend: {
    classGroups: {
      "bg-decoration": ["bg-page-glow"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
