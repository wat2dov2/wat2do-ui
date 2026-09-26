"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import imageDelivery from "../../../../backend/controlbox/image_delivery.json" with { type: "json" };
import { ImageOff } from "@/shared/ui/doodle-icons";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

type LazyImageProps = {
  src?: string | null;
  alt: string;
  loading?: "eager" | "lazy";
  className?: string;
  fallback?: ReactNode;
  fit?: "cover" | "contain";
} & (
  | { sizes: string; width?: never; height?: never }
  | { width: number; height: number; sizes?: never }
);

function canOptimizeImage(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" &&
      url.hostname === imageDelivery.optimized_remote_host &&
      url.pathname.startsWith(imageDelivery.optimized_remote_path);
  } catch {
    return false;
  }
}

function ImageContent({
  src,
  alt,
  sizes,
  width,
  height,
  loading = "lazy",
  className,
  fallback,
  fit = "cover",
}: LazyImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const unavailable = !src || status === "error";

  return (
    <div
      data-slot="lazy-image"
      data-image-state={src ? status : "missing"}
      className={cn("relative overflow-hidden", className)}
    >
      {unavailable ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-surface-elevated text-muted-foreground"
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
        >
          {fallback === undefined ? <ImageOff className="size-8 opacity-40" /> : fallback}
        </div>
      ) : (
        <>
          {status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
          <Image
            src={src}
            alt={alt}
            fill={width === undefined}
            width={width}
            height={height}
            sizes={sizes}
            quality={imageDelivery.quality}
            unoptimized={!canOptimizeImage(src)}
            loading={loading}
            fetchPriority={loading === "eager" ? "high" : undefined}
            decoding="async"
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
            className={cn("relative", fit === "contain" ? "object-contain" : "object-cover")}
          />
        </>
      )}
    </div>
  );
}

/** Native image discovery and loading, with state scoped to the current URL. */
export function LazyImage(props: LazyImageProps) {
  return <ImageContent key={props.src} {...props} />;
}
