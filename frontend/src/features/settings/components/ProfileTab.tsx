import { useTranslation } from "react-i18next";
import type { UserProfile } from "@/features/auth";
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
import { Skeleton } from "@/shared/ui/skeleton";

interface ProfileTabProps {
  profile: UserProfile;
  isLoading: boolean;
  disabled: boolean;
  onProfileChange: (updates: Partial<UserProfile>) => void;
}

/** The visitor's school, faculty, year and interests; their photo sits in the profile header. */
export function ProfileTab({
  profile,
  isLoading,
  disabled,
  onProfileChange,
}: ProfileTabProps) {
  const { interests } = useAppConstants();
  const { t } = useTranslation();
  const { schoolBySlug } = useSchoolDirectory();
  const faculties = schoolBySlug.get(profile.school ?? "")?.faculties ?? [];
  const controlsDisabled = isLoading || disabled;

  return (
    <div className="space-y-6" aria-busy={isLoading}>
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
