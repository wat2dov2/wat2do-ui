import { LazyImage } from "@/shared/ui/lazy-image";

interface AvatarStackProps {
  avatars: { src: string; name: string }[];
  overflowCount?: number;
  overflowLabel?: string;
}

/** Overlapping profile images with accessible names and an optional overflow count. */
export function AvatarStack({ avatars, overflowCount = 0, overflowLabel }: AvatarStackProps) {
  return (
    <div data-slot="avatar-stack" className="flex items-center -space-x-2">
      {avatars.map((avatar, index) => (
        <div
          key={index}
          title={avatar.name}
          className="relative flex size-9 shrink-0 overflow-hidden rounded-full border-2 border-background bg-muted"
        >
          <LazyImage
            src={avatar.src}
            alt={avatar.name}
            width={32}
            height={32}
            className="size-full"
            fallback={<span aria-hidden="true" className="text-xs">{avatar.name.slice(0, 1)}</span>}
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
