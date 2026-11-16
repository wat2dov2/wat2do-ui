import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import { Stack } from "@/shared/layout";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

export interface ProfileIdentity {
  /** The visitor's name, or their email's name part when they never set one. */
  name: string;
  email: string;
  schoolName: string | null;
}

interface ProfileHeaderProps {
  /** The photo, or its picker. */
  avatar: ReactNode;
  /** Who the visitor is; null while the session is still being read. */
  identity: ProfileIdentity | null;
  /** Admin for admins, then Log out: small, at the header's top right. */
  controls: ReactNode;
}

/**
 * The top of the visitor's own page: a large photo beside their name, email
 * and school, with their controls at the top right, taking no row of their
 * own. It keeps one height while the session loads, so the tabs below never move.
 */
export function ProfileHeader({ avatar, identity, controls }: ProfileHeaderProps) {
  return (
    <header data-slot="profile-header">
      <Stack direction="horizontal" gap={5} align="center">
        {avatar}
        <Stack gap={1} className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold text-foreground">
            {identity ? identity.name : <SkeletonLine className="w-48" />}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {identity ? identity.email : <SkeletonLine className="w-56" />}
          </p>
          {identity?.schoolName !== null ? (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <GraduationCap aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {identity ? identity.schoolName : <SkeletonLine className="w-40" />}
              </span>
            </p>
          ) : null}
        </Stack>
        {/* Pinned to the top, beside the name, rather than centred on the photo. */}
        <Stack direction="horizontal" gap={2} className="shrink-0 self-start">
          {controls}
        </Stack>
      </Stack>
    </header>
  );
}

/** The header's photo while the session loads. */
export function ProfileAvatarSkeleton() {
  return <Skeleton className="size-20 shrink-0 rounded-full" />;
}
