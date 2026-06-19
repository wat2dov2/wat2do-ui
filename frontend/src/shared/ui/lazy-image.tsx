import React, { useState } from "react";
import { ImageOff } from "@/shared/ui/doodle-icons";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallback?: React.ReactNode;
  placeholder?: React.ReactNode;
}

export function LazyImage({
  src,
  alt,
  className,
  fallback,
  placeholder,
  ...props
}: LazyImageProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  if (!src || imageError) {
    return (
      <div className={className} style={{ position: "absolute", inset: 0 }}>
        {fallback || (
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 flex items-center justify-center">
            <ImageOff className="size-8 text-muted-foreground/40" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      {!imageLoaded && placeholder && (
        <div className="absolute inset-0">{placeholder}</div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          imageLoaded ? "opacity-100" : "opacity-0"
        }`}
        {...props}
      />
    </div>
  );
}

