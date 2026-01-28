/**
 * PhotoWithCaption Component
 * Reusable component for displaying images with captions
 */

import { useTranslation } from "react-i18next";
import { ImageWithFallback } from "@/shared/ui/image-with-fallback";

interface PhotoWithCaptionProps {
  src: string;
  altKey: string;
  captionKey: string;
  className?: string;
}

export function PhotoWithCaption({
  src,
  altKey,
  captionKey,
  className = "mb-32",
}: PhotoWithCaptionProps) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <ImageWithFallback
        src={src}
        alt={t(altKey)}
        className="w-full h-[360px] object-cover rounded-[12px] mb-4"
      />
      <p className="font-sans text-[13px] text-muted-foreground italic">
        {t(captionKey)}
      </p>
    </div>
  );
}
