/**
 * ProfileTab Component
 * UI component for profile settings
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
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
import { useProfile } from "@/features/settings/hooks/useProfile";
import { availableSchools } from "@/features/events/data/events";
import { availableInterests } from "@/shared/data/interests";

const availableFaculties = [
  "Engineering",
  "Mathematics",
  "Science",
  "Arts",
  "Environment",
  "Health",
  "Applied Health Sciences",
];

interface ProfileTabProps {
  userEmail: string | null;
}

export function ProfileTab({ userEmail }: ProfileTabProps) {
  const { t } = useTranslation();
  const { profile, updateProfile, toggleInterest } = useProfile();

  return (
    <div className="space-y-6">
      {userEmail && (
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-display" className="text-base font-medium">
                {t("settings.profile.email")}
              </Label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">{userEmail}</span>
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
                {availableFaculties.map((faculty) => {
                  const facultyKey = faculty.toLowerCase().replace(/\s+/g, "");
                  const translationKey = `onboarding.faculties.${
                    facultyKey === "appliedhealthsciences"
                      ? "appliedHealthSciences"
                      : facultyKey
                  }`;
                  return (
                    <SelectItem key={faculty} value={faculty}>
                      {t(translationKey) || faculty}
                    </SelectItem>
                  );
                })}
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
              options={availableInterests}
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
