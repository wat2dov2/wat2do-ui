import { DrawerBody, FormGrid, Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";
import { Separator } from "@/shared/ui/separator";
import { DrawerHeader } from "@/shared/ui/drawer";

export function EventDetailsDrawerSkeleton() {
  return (
    <>
      <DrawerHeader className="text-left" navigation={{}}>
        <Stack direction="horizontal" justify="end" align="center" gap={2} wrap aria-hidden="true">
          <Skeleton className="h-8 w-36 rounded-xl" />
          <Skeleton className="h-8 w-20 rounded-xl" />
          <Skeleton className="h-8 w-20 rounded-xl" />
        </Stack>
      </DrawerHeader>

      <Separator />

      <DrawerBody aria-hidden="true">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-8">
          <Skeleton className="mx-auto aspect-square w-full max-w-sm rounded-xl md:col-start-1 md:mx-0" />

          <div className="contents md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:flex-col md:gap-6">
            <Stack gap={2} className="order-1">
              <Skeleton className="h-7 w-4/5 rounded-lg sm:h-9" />
              <Skeleton className="h-4 w-48 rounded-lg" />
            </Stack>

            <Stack gap={6} className="order-3">
              <FormGrid columns={2} collapse={false}>
                {Array.from({ length: 4 }, (_, index) => (
                  <Stack key={index} direction="horizontal" align="center" gap={3}>
                    <Skeleton className="size-10 shrink-0 rounded-xl" />
                    <Stack gap={2} grow>
                      <Skeleton className="h-4 w-4/5 rounded-lg" />
                      <Skeleton className="h-4 w-full rounded-lg" />
                    </Stack>
                  </Stack>
                ))}
              </FormGrid>
              <Skeleton className="h-32 w-full rounded-xl" />
            </Stack>

            <Stack gap={3} className="order-4">
              <Stack gap={2}>
                <Skeleton className="h-4 w-24 rounded-lg" />
                <Separator />
              </Stack>
              <Stack gap={2}>
                <Skeleton className="h-4 w-full rounded-lg" />
                <Skeleton className="h-4 w-11/12 rounded-lg" />
              </Stack>
            </Stack>
          </div>

          <Stack gap={6} className="order-2 md:col-start-1">
            <Stack gap={3}>
              <Stack gap={2}>
                <Skeleton className="h-4 w-24 rounded-lg" />
                <Separator />
              </Stack>
              <Skeleton className="h-7 w-40 rounded-xl" />
            </Stack>
            <Stack gap={3}>
              <Stack gap={2}>
                <Skeleton className="h-4 w-24 rounded-lg" />
                <Separator />
              </Stack>
              <Stack direction="horizontal" gap={1}>
                {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="size-8 rounded-full" />)}
              </Stack>
            </Stack>
          </Stack>
        </div>
      </DrawerBody>
    </>
  );
}
