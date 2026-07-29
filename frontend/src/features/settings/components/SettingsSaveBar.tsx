import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/shared/ui/item";
import { LoadingButton } from "@/shared/ui/loading-button";

interface SettingsSaveBarProps {
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export function SettingsSaveBar({
  isSaving,
  onCancel,
  onSave,
}: SettingsSaveBarProps) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <Item
        variant="outline"
        size="sm"
        className="pointer-events-auto w-full max-w-xl bg-surface-elevated shadow-sm"
        data-testid="settings-save-bar"
      >
        <ItemContent>
          <ItemTitle>{t("settings.unsavedChanges")}</ItemTitle>
          <ItemDescription>
            {t("settings.unsavedChangesDescription")}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isSaving}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <LoadingButton
            type="button"
            size="sm"
            isLoading={isSaving}
            onClick={onSave}
          >
            {t("forms.saveChanges")}
          </LoadingButton>
        </ItemActions>
      </Item>
    </div>
  );
}
