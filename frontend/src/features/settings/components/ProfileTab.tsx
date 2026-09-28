import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UserProfile } from "@/features/auth";
import { Mail, Camera } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Separator } from "@/shared/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { MultiSelect } from "@/shared/ui/multi-select";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { toFacultyTranslationKey } from "@/shared/utils/string";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { LazyImage } from "@/shared/ui/lazy-image";
import { Skeleton } from "@/shared/ui/skeleton";

interface ProfileTabProps {
  userEmail: string | null;
  profile: UserProfile;
  avatarPreviewUrl: string | null;
  isLoading: boolean;
  disabled: boolean;
  onProfileChange: (updates: Partial<UserProfile>) => void;
  onAvatarChange: (file: File) => void;
}

export function ProfileTab({
  userEmail,
  profile,
  avatarPreviewUrl,
  isLoading,
  disabled,
  onProfileChange,
  onAvatarChange,
}: ProfileTabProps) {
  const { interests } = useAppConstants();
  const { t } = useTranslation();
  const { schoolBySlug } = useSchoolDirectory();
  const faculties = schoolBySlug.get(profile.school ?? "")?.faculties ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarUrl = avatarPreviewUrl ?? profile.avatarUrl;
  const controlsDisabled = isLoading || disabled;

  return (
    <div className="space-y-6" aria-busy={isLoading}>
      {userEmail && (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="size-16 rounded-full bg-secondary flex items-center justify-center overflow-hidden border-2 border-border">
                  {isLoading ? (
                    <Skeleton className="size-full rounded-full" />
                  ) : avatarUrl ? (
                    <LazyImage
                      src={avatarUrl}
                      alt={t("settings.profile.avatarAlt")}
                      width={64}
                      height={64}
                      className="size-full"
                      fallback={(userEmail[0] ?? "?").toUpperCase()}
                    />
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">
                      {(userEmail?.[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="absolute -bottom-1 -right-1 rounded-full size-7 p-0"
                  onClick={() => fileRef.current?.click()}
                  disabled={controlsDisabled}
                  aria-label={t("settings.profile.changeAvatar")}
                >
                  <Camera className="size-3.5" />
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onAvatarChange(file);
                    }
                    event.target.value = "";
                  }}
                  className="hidden"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{userEmail}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="school" className="text-base font-medium">
              {t("settings.profile.school")}
            </Label>
            {isLoading ? <Skeleton className="h-9 w-full" /> : <SchoolCombobox
              id="school"
              value={profile.school || ""}
              onChange={(value) => onProfileChange({ school: value, faculty: "" })}
              variant="field"
              placeholder={t("settings.profile.selectSchool")}
            />}
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="faculty" className="text-base font-medium">
              {t("settings.profile.faculty")}
            </Label>
            {isLoading ? <Skeleton className="h-9 w-full" /> : <Select
              value={profile.faculty}
              onValueChange={(value) => onProfileChange({ faculty: value })}
              disabled={controlsDisabled}
            >
              <SelectTrigger id="faculty" className="w-full">
                <SelectValue placeholder={t("settings.profile.selectFaculty")} />
              </SelectTrigger>
              <SelectContent>
                {faculties.map((faculty) => (
                  <SelectItem key={faculty} value={faculty}>
                    {(() => {
                      const key = toFacultyTranslationKey(faculty);
                      const translated = t(key);
                      return translated !== key ? translated : faculty;
                    })()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>}
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-base font-medium">
              {t("settings.profile.firstYearStudent")}
            </Label>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t("modals.profile.firstYearQuestion")}
              </p>
              {isLoading ? <Skeleton className="h-6 w-11 rounded-full" /> : <Switch
                checked={profile.isFirstYear}
                disabled={controlsDisabled}
                onCheckedChange={(checked) =>
                  onProfileChange({ isFirstYear: checked })
                }
              />}
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label className="text-base font-medium">
              {t("settings.profile.interests")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.profile.selectInterests")}
            </p>
            {isLoading ? <Skeleton className="h-20 w-full" /> : <MultiSelect
              options={interests}
              selected={profile.interests}
              onToggle={(interest) => {
                const next = profile.interests.includes(interest)
                  ? profile.interests.filter((value) => value !== interest)
                  : [...profile.interests, interest];
                onProfileChange({ interests: next });
              }}
              translationKeyPrefix="categories"
            />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
