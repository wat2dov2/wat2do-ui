"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

type LazyImageProps = {
  src?: string | null;
  /** Loaded instead when `src` fails, such as the original of a stored thumbnail that is missing. */
  fallbackSrc?: string | null;
  alt: string;
  /** Detail media can play a stored video while retaining this image as its poster. */
  videoSrc?: string | null;
  loading?: "eager" | "lazy";
  className?: string;
  fallback?: ReactNode;
  fit?: "cover" | "contain";
  onLoad?: (image: HTMLImageElement) => void;
  /** Fixed pixel size; without one the image fills its positioned parent. */
  width?: number;
  height?: number;
};

function ImageContent({
  src,
  fallbackSrc,
  alt,
  videoSrc,
  width,
  height,
  loading = "lazy",
  className,
  fallback,
  fit = "cover",
  onLoad,
}: LazyImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [imageSrc, setImageSrc] = useState(src);
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = Boolean(videoSrc) && !videoFailed;
  const unavailable = !showVideo && (!imageSrc || status === "error");

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
          poster={src ?? undefined}
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
            src={imageSrc!}
            alt={alt}
            fill={width === undefined}
            width={width}
            height={height}
            loading={loading}
            fetchPriority={loading === "eager" ? "high" : undefined}
            decoding="async"
            onLoad={event => { setStatus("loaded"); onLoad?.(event.currentTarget); }}
            onError={() => (fallbackSrc && imageSrc !== fallbackSrc ? setImageSrc(fallbackSrc) : setStatus("error"))}
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
