"use client"

import Image from "next/image"
import { cva } from "class-variance-authority"

import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory"
import { resolveSchool } from "@/shared/constants/schools"
import { getSchoolLogoImage } from "@/shared/lib/schoolLogo"
import { cn } from "@/shared/lib/utils"

const brandLogoVariants = cva("shrink-0 select-none object-contain", {
  variants: {
    size: {
      nav: "h-6 w-[34px]",
      card: "h-7 w-[40px]",
      hero: "h-10 w-[57px] opacity-90",
    },
  },
})

const BRAND_LOGO_PIXELS = {
  nav: { width: 34, height: 24 },
  card: { width: 40, height: 28 },
  hero: { width: 57, height: 40 },
} as const

interface BrandLogoProps {
  size: keyof typeof BRAND_LOGO_PIXELS
  /** The school whose logo to show; schools with enough events have one built from their posters. */
  school: string
  alt: string
}

/** The wat2do mark, per school: its poster logo when it has one, otherwise the standard logo. */
export function BrandLogo({ school, size, alt }: BrandLogoProps) {
  const { schoolBySlug } = useSchoolDirectory()
  const { src } = getSchoolLogoImage(schoolBySlug.get(resolveSchool(school)))
  return (
    <Image
      alt={alt}
      src={src}
      {...BRAND_LOGO_PIXELS[size]}
      className={cn(brandLogoVariants({ size }))}
    />
  )
}
