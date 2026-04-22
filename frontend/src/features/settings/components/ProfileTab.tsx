/**
 * ProfileTab Component
 * UI component for profile settings
 */

import React, { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Camera } from "lucide-react";
import { Card, CardContent } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
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
import { useProfile } from "@/features/settings/hooks/useProfile";
import { availableSchools } from "@/shared/constants/schools";
import { getAvailableInterests } from "@/shared/data/interests";
import { toFacultyTranslationKey } from "@/shared/utils/string";
import { FACULTY_OPTIONS } from "@/features/auth";

interface ProfileTabProps {
  userEmail: string | null;
}

export function ProfileTab({ userEmail }: ProfileTabProps) {
  const { t } = useTranslation();
  const { profile, updateProfile, toggleInterest } = useProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadAvatar } = await import("@/shared/services/uploadService");
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
    } catch (err) {
      console.error("Failed to upload avatar:", err);
    } finally {
      setUploading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {userEmail && (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center overflow-hidden border-2 border-border">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">
                      {(userEmail?.[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </div>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="absolute -bottom-1 -right-1 rounded-full w-7 h-7 p-0"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  isLoading={uploading}
                  loadingText=""
                >
                  <Camera className="w-3.5 h-3.5" />
                </LoadingButton>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{userEmail}</span>
                </div>
                {uploading && <p className="text-xs text-muted-foreground mt-1">Uploading...</p>}
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
            <Select
              value={profile.school}
              onValueChange={(value) => updateProfile({ school: value })}
            >
              <SelectTrigger id="school" className="w-full">
                <SelectValue placeholder={t("settings.profile.selectSchool")} />
              </SelectTrigger>
              <SelectContent>
                {availableSchools.map((school) => (
                  <SelectItem key={school} value={school}>
                    {school}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="faculty" className="text-base font-medium">
              {t("settings.profile.faculty")}
            </Label>
            <Select
              value={profile.faculty}
              onValueChange={(value) => updateProfile({ faculty: value })}
            >
              <SelectTrigger id="faculty" className="w-full">
                <SelectValue placeholder={t("settings.profile.selectFaculty")} />
              </SelectTrigger>
              <SelectContent>
                {FACULTY_OPTIONS.map((faculty) => (
                  <SelectItem key={faculty} value={faculty}>
                    {t(toFacultyTranslationKey(faculty)) || faculty}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <Switch
                checked={profile.isFirstYear}
                onCheckedChange={(checked) =>
                  updateProfile({ isFirstYear: checked })
                }
              />
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
            <MultiSelect
              options={getAvailableInterests()}
              selected={profile.interests}
              onToggle={toggleInterest}
              translationKeyPrefix="categories"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
