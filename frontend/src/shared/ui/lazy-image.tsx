"use client";

import { useState, type ReactNode } from "react";
import Image, { getImageProps } from "next/image";
import imageDelivery from "../../../../backend/controlbox/image_delivery.json" with { type: "json" };
import { ImageOff } from "@/shared/ui/doodle-icons";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

type LazyImageProps = {
  src?: string | null;
  alt: string;
  /** Detail media can play a stored video while retaining this image as its poster. */
  videoSrc?: string | null;
  loading?: "eager" | "lazy";
  className?: string;
  fallback?: ReactNode;
  fit?: "cover" | "contain";
  onLoad?: (image: HTMLImageElement) => void;
} & (
  | { sizes: string; width?: never; height?: never }
  | { width: number; height: number; sizes?: never }
);

function canOptimizeImage(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const url = new URL(src);
    return url.origin === `https://${imageDelivery.optimized_remote_host}` &&
      url.pathname.startsWith(imageDelivery.optimized_remote_path);
  } catch {
    return false;
  }
}

function ImageContent({
  src,
  alt,
  videoSrc,
  sizes,
  width,
  height,
  loading = "lazy",
  className,
  fallback,
  fit = "cover",
  onLoad,
}: LazyImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = Boolean(videoSrc) && !videoFailed;
  const unavailable = !showVideo && (!src || status === "error");
  // getImageProps selects the 2x candidate for src. Reuse a warmed variant.
  const posterSize = imageDelivery.warm_widths.at(-1)! / 2;
  const poster = showVideo && src ? getImageProps({
    src,
    alt,
    width: posterSize,
    height: posterSize,
    quality: imageDelivery.quality,
    unoptimized: !canOptimizeImage(src),
  }).props.src : undefined;

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
      ) : showVideo ? (
        <video
          key={videoSrc}
          src={videoSrc!}
          poster={poster}
          controls
          data-vaul-no-drag
          playsInline
          preload="none"
          aria-label={alt}
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <>
          {status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
          <Image
            src={src!}
            alt={alt}
            fill={width === undefined}
            width={width}
            height={height}
            // Lazy images can select a candidate from their actual rendered
            // width; eager images still need the supplied size before layout.
            sizes={sizes && loading === "lazy" ? `auto, ${sizes}` : sizes}
            quality={imageDelivery.quality}
            unoptimized={!canOptimizeImage(src!)}
            loading={loading}
            fetchPriority={loading === "eager" ? "high" : undefined}
            decoding="async"
            onLoad={event => { setStatus("loaded"); onLoad?.(event.currentTarget); }}
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
  return <ImageContent key={`${props.src ?? ""}/${props.videoSrc ?? ""}`} {...props} />;
}
