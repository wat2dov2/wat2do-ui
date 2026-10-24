import type { ApiInstagramAccountPostResponse } from "@/shared/generated";
import { SocialPostTile } from "@/features/admin/components/social/SocialPostTile";
import { useHorizontalScrollFade } from "@/shared/hooks/useHorizontalScrollFade";
import { HorizontalScrollFade } from "@/shared/ui/horizontal-scroll-fade";

/** An account's posts in one scrolling row, fading at the edge while more remain. */
export function SocialPostStrip({ posts }: { posts: ApiInstagramAccountPostResponse[] }) {
  const { scrollRef, scrollEndRef, showScrollFade, syncScrollFade, syncScrollFadeAfterWheel, dragScrollProps } =
    useHorizontalScrollFade({ refreshKey: posts.length });
  return (
    <HorizontalScrollFade
      ref={scrollRef}
      visible={showScrollFade}
      {...dragScrollProps}
      onScroll={syncScrollFade}
      onWheel={syncScrollFadeAfterWheel}
      onTouchEnd={syncScrollFade}
      className="no-visible-scrollbar flex cursor-grab gap-3 overflow-x-auto active:cursor-grabbing"
    >
      {posts.map(post => <SocialPostTile key={post.media_id} post={post} layout="strip" />)}
      <span ref={scrollEndRef} aria-hidden="true" className="h-px w-px shrink-0" />
    </HorizontalScrollFade>
  );
}
