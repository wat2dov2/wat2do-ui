import { Avatar as AvatarPrimitive } from "radix-ui";

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
        <AvatarPrimitive.Root
          key={index}
          title={avatar.name}
          className="relative flex size-9 shrink-0 overflow-hidden rounded-full border-2 border-background bg-muted"
        >
          <AvatarPrimitive.Image src={avatar.src} alt={avatar.name} className="size-full object-cover" />
          <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-xs text-muted-foreground">
            <span aria-hidden="true">{avatar.name.slice(0, 1)}</span>
            <span className="sr-only">{avatar.name}</span>
          </AvatarPrimitive.Fallback>
        </AvatarPrimitive.Root>
      ))}
      {overflowCount > 0 ? (
        <span title={overflowLabel} aria-label={overflowLabel} className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground">
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
