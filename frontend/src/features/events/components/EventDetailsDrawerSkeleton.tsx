import { DrawerBody, Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";
import { Separator } from "@/shared/ui/separator";
import { DrawerHeader } from "@/shared/ui/drawer";

export function EventDetailsDrawerSkeleton() {
  return (
    <>
      <DrawerHeader className="text-left">
        <Stack direction="horizontal" justify="between" gap={3} className="flex-wrap">
          <Skeleton className="h-6 w-20 rounded-xl" />
          <Stack direction="horizontal" gap={2}>
            <Skeleton className="h-8 w-24 rounded-xl" />
            <Skeleton className="h-8 w-24 rounded-xl" />
            <Skeleton className="h-8 w-20 rounded-xl" />
            <Skeleton className="h-8 w-20 rounded-xl" />
          </Stack>
        </Stack>
      </DrawerHeader>

      <Separator />

      <DrawerBody>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:items-start md:gap-x-8">
          <Skeleton className="mx-auto aspect-square w-full max-w-sm rounded-xl md:mx-0" />

          <Stack gap={6}>
            <Skeleton className="h-8 w-4/5 rounded-lg" />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>

            <Skeleton className="h-32 w-full rounded-xl" />

            <Stack gap={2}>
              <Skeleton className="h-4 w-24 rounded-lg" />
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-11/12 rounded-lg" />
            </Stack>
          </Stack>

          <Stack gap={2} className="hidden md:flex">
            <Skeleton className="h-4 w-24 rounded-lg" />
            <Skeleton className="h-4 w-40 rounded-lg" />
          </Stack>
        </div>
      </DrawerBody>
    </>
  );
}
