import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { useDrawerPortalContainer } from "@/shared/ui/drawer-portal-context";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/shared/ui/item";
import { LoadingButton } from "@/shared/ui/loading-button";

interface SaveBarProps {
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

/**
 * The floating bar an edit form shows while it has unsaved changes: Save or
 * Discard, near the bottom edge. On a page it floats over the window, clear
 * of the back-to-top corner; inside a drawer it floats over the drawer. Where
 * it is placed, it holds room at the end of the content, so the last field
 * never hides under it.
 */
export function SaveBar({ isSaving, onDiscard, onSave }: SaveBarProps) {
  const { t } = useTranslation();
  const drawer = useDrawerPortalContainer();

  const bar = (
    <div
      data-slot="save-bar"
      className={cn(
        "pointer-events-none inset-x-0 z-40 flex justify-center",
        "bottom-[calc(--spacing(4)+env(safe-area-inset-bottom))]",
        drawer
          ? "absolute px-4"
          : // The window's back-to-top button sits in the bottom-right corner.
            "fixed pr-16 pl-4 sm:px-16",
      )}
    >
      <Item
        variant="outline"
        size="sm"
        className="pointer-events-auto w-full max-w-xl bg-surface-elevated shadow-sm"
        data-testid="save-bar"
      >
        <ItemContent>
          <ItemTitle>{t("forms.unsavedChanges")}</ItemTitle>
          <ItemDescription>{t("forms.unsavedChangesDescription")}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={onDiscard}
          >
            {t("forms.discard")}
          </Button>
          <LoadingButton
            type="button"
            size="sm"
            isLoading={isSaving}
            onClick={onSave}
          >
            {t("forms.save")}
          </LoadingButton>
        </ItemActions>
      </Item>
    </div>
  );

  return (
    <>
      <div aria-hidden="true" data-slot="save-bar-space" className="h-24 shrink-0" />
      {drawer ? createPortal(bar, drawer) : bar}
    </>
  );
}
