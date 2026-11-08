import { LazyImage } from "@/shared/ui/lazy-image";
import { logoThumbnailUrl } from "@/shared/utils/media";

interface AvatarStackProps {
  avatars: { src: string; name: string }[];
  size?: "default" | "sm" | "lg";
  overflowCount?: number;
  overflowLabel?: string;
  /** Eager for avatars on the first screen, so they arrive with the page instead of one by one after it. */
  loading?: "eager" | "lazy";
  /** The names are already written beside the avatars, so the images stay silent. */
  decorative?: boolean;
}

const AVATAR_SIZES = {
  sm: { box: "size-5", px: 20, fallback: "text-xs" },
  default: { box: "size-9", px: 32, fallback: "text-xs" },
  /** A single club's logo leading its card. */
  lg: { box: "size-12", px: 48, fallback: "text-base font-medium" },
} as const;

/** Overlapping profile images with accessible names and an optional overflow count. */
export function AvatarStack({ avatars, size = "default", overflowCount = 0, overflowLabel, loading = "lazy", decorative = false }: AvatarStackProps) {
  const { box, px, fallback } = AVATAR_SIZES[size];
  return (
    <div data-slot="avatar-stack" className={size === "sm" ? "flex shrink-0 items-center -space-x-1.5" : "flex shrink-0 items-center -space-x-2"}>
      {avatars.map((avatar, index) => (
        <div
          key={index}
          title={decorative ? undefined : avatar.name}
          className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted ${box}`}
        >
          <LazyImage
            // Avatars are at most 48 px, so a club logo shows its stored thumbnail.
            src={logoThumbnailUrl(avatar.src)}
            fallbackSrc={avatar.src}
            alt={decorative ? "" : avatar.name}
            width={px}
            height={px}
            loading={loading}
            className="size-full"
            fallback={<span aria-hidden="true" className={`text-muted-foreground ${fallback}`}>{avatar.name.replace(/^@/, "").slice(0, 1).toUpperCase()}</span>}
          />
        </div>
      ))}
      {overflowCount > 0 ? (
        <span title={overflowLabel} aria-label={overflowLabel} className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground">
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
