import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import { DrawerClose } from "@/shared/ui/drawer";
import { Skeleton } from "@/shared/ui/skeleton";
import { ModalContentWrapper, ModalSection } from "@/shared/ui/modal-components";

export function EventDetailsDrawerSkeleton() {
  const { t } = useTranslation();

  return (
    <>
      <DrawerClose asChild>
        <button
          type="button"
          className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </button>
      </DrawerClose>

      <div className="relative h-64 w-full overflow-hidden sm:h-80">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>

      <ModalContentWrapper className="space-y-4 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start gap-3 pb-5 sm:pb-0">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-4/5 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Skeleton className="size-8 rounded-xl" />
            <Skeleton className="size-8 rounded-xl" />
            <Skeleton className="size-8 rounded-xl" />
          </div>
        </div>

        <ModalSection className="mt-2 space-y-4 pt-2 sm:mt-0 sm:pt-0">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 rounded-lg" />
            <Skeleton className="h-4 w-full rounded-lg" />
            <Skeleton className="h-4 w-11/12 rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28 rounded-lg" />
            <Skeleton className="h-8 w-full rounded-full" />
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-20 rounded-lg" />
              <Skeleton className="h-4 w-2/3 rounded-lg" />
            </div>
          ))}
        </ModalSection>
      </ModalContentWrapper>
    </>
  );
}
