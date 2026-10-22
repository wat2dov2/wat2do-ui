import { LazyImage } from "@/shared/ui/lazy-image";

interface AvatarStackProps {
  avatars: { src: string; name: string }[];
  size?: "default" | "sm" | "lg";
  overflowCount?: number;
  overflowLabel?: string;
}

const AVATAR_SIZES = {
  sm: { box: "size-5", px: 20, fallback: "text-xs" },
  default: { box: "size-9", px: 32, fallback: "text-xs" },
  /** A single club's logo leading its card. */
  lg: { box: "size-12", px: 48, fallback: "text-base font-medium" },
} as const;

/** Overlapping profile images with accessible names and an optional overflow count. */
export function AvatarStack({ avatars, size = "default", overflowCount = 0, overflowLabel }: AvatarStackProps) {
  const { box, px, fallback } = AVATAR_SIZES[size];
  return (
    <div data-slot="avatar-stack" className={size === "sm" ? "flex shrink-0 items-center -space-x-1.5" : "flex shrink-0 items-center -space-x-2"}>
      {avatars.map((avatar, index) => (
        <div
          key={index}
          title={avatar.name}
          className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted ${box}`}
        >
          <LazyImage
            src={avatar.src}
            alt={avatar.name}
            width={px}
            height={px}
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
