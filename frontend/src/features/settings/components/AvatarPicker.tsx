import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { LazyImage } from "@/shared/ui/lazy-image";
import { Skeleton } from "@/shared/ui/skeleton";

interface AvatarPickerProps {
  /** The picked photo's preview, else the saved one. */
  avatarUrl: string | null;
  /** The letter shown while there is no photo. */
  initial: string;
  isLoading: boolean;
  disabled: boolean;
  onAvatarChange: (file: File) => void;
}

/** The visitor's photo, with a button on its edge to pick a new one; the settings save bar saves it. */
export function AvatarPicker({ avatarUrl, initial, isLoading, disabled, onAvatarChange }: AvatarPickerProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div data-slot="avatar-picker" className="relative shrink-0">
      <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
        {isLoading ? (
          <Skeleton className="size-full rounded-full" />
        ) : avatarUrl ? (
          <LazyImage
            src={avatarUrl}
            alt={t("settings.profile.avatarAlt")}
            width={80}
            height={80}
            loading="eager"
            className="size-full"
            fallback={initial}
          />
        ) : (
          <span className="text-2xl font-semibold text-muted-foreground">{initial}</span>
        )}
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        className="absolute -right-1 -bottom-1 rounded-full"
        onClick={() => fileRef.current?.click()}
        disabled={isLoading || disabled}
        aria-label={t("settings.profile.changeAvatar")}
      >
        <Camera />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAvatarChange(file);
          event.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
