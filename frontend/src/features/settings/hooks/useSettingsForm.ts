import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import {
  fetchProfileAPI,
  getLastProfileFetchAt,
  useAuthState,
  updateProfileAPI,
  type UserProfile,
} from "@/features/auth";
import {
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from "@/features/settings/api/notificationPreferences.api";
import {
  loadProfile,
  saveProfile,
} from "@/features/settings/api/settings.api";
import { controlBox } from "@/shared/config/controlBox";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import {
  LANGUAGE_CODES,
  type SupportedLanguage,
} from "@/shared/constants/languages";
import { toast } from "@/shared/hooks/use-toast";
import { loadLanguage } from "@/shared/lib/loadLanguage";
import { queryKeys } from "@/shared/lib/queryKeys";
import { uploadAvatar } from "@/shared/services/uploadService";
import { useUIStore } from "@/shared/store/ui.store";
import type { ViewMode } from "@/shared/types";

const DEFAULT_PROFILE: UserProfile = {
  id: "",
  fullName: null,
  avatarUrl: null,
  faculty: "",
  interests: [],
  isFirstYear: false,
  school: DEFAULT_SCHOOL,
  role: "user",
  hasOrganization: false,
  clubs: [],
  organizationId: null,
  organizationName: null,
  payoutEmail: null,
  promoterTosAcceptedAt: null,
  promoterTosVersion: null,
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  morningEmail: true,
  eventReminder: true,
  eventChange: true,
};

export interface AppearanceSettingsDraft {
  language: SupportedLanguage;
  viewMode: ViewMode;
}

interface SettingsFormValues {
  profile: UserProfile;
  notifications: NotificationPreferences;
  appearance: AppearanceSettingsDraft;
  avatarFile: File | null;
}

interface SavedSettings {
  values: SettingsFormValues;
  profileChanged: boolean;
  notificationsChanged: boolean;
}

function resolveLanguage(language: string): SupportedLanguage {
  return LANGUAGE_CODES.includes(language)
    ? (language as SupportedLanguage)
    : "en";
}

export function useSettingsForm() {
  const { i18n, t } = useTranslation();
  const auth = useAuthState();
  const queryClient = useQueryClient();
  const persistedViewMode = useUIStore((state) => state.viewMode);
  const setPersistedViewMode = useUIStore((state) => state.setViewMode);
  const [cachedProfile] = useState(() => loadProfile());
  const [initialAppearance] = useState<AppearanceSettingsDraft>(() => ({
    language: resolveLanguage(i18n.resolvedLanguage ?? i18n.language),
    viewMode: persistedViewMode,
  }));
  const [initialValues] = useState<SettingsFormValues>(() => ({
    profile: cachedProfile ?? DEFAULT_PROFILE,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    appearance: initialAppearance,
    avatarFile: null,
  }));
  const initialValuesRef = useRef(initialValues);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const avatarPreviewUrlRef = useRef<string | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.user.all,
    queryFn: fetchProfileAPI,
    enabled: Boolean(auth.userId),
    initialData: cachedProfile ?? undefined,
    initialDataUpdatedAt: getLastProfileFetchAt() || undefined,
    staleTime: controlBox.clientCache.profileStaleMs,
  });
  const notificationQueryKey = queryKeys.notificationPreferences.byUser(
    auth.userId ?? "",
  );
  const notificationQuery = useQuery({
    queryKey: notificationQueryKey,
    queryFn: fetchNotificationPreferences,
    enabled: Boolean(auth.userId),
  });

  const form = useForm<SettingsFormValues>({
    defaultValues: initialValues,
  });
  const profile = useWatch({ control: form.control, name: "profile" });
  const notifications = useWatch({
    control: form.control,
    name: "notifications",
  });
  const appearance = useWatch({
    control: form.control,
    name: "appearance",
  });

  useEffect(() => {
    return () => {
      if (avatarPreviewUrlRef.current) {
        URL.revokeObjectURL(avatarPreviewUrlRef.current);
      }
    };
  }, []);

  const clearAvatarPreview = useCallback(() => {
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
  }, []);

  useEffect(() => {
    if (
      !profileQuery.data ||
      !notificationQuery.data ||
      form.formState.isDirty
    ) {
      return;
    }
    const hydratedValues: SettingsFormValues = {
      profile: profileQuery.data,
      notifications: notificationQuery.data,
      appearance: initialValuesRef.current.appearance,
      avatarFile: null,
    };
    initialValuesRef.current = hydratedValues;
    form.reset(hydratedValues);
  }, [
    form,
    form.formState.isDirty,
    notificationQuery.data,
    profileQuery.data,
  ]);

  const saveMutation = useMutation({
    mutationFn: async (nextValues: SettingsFormValues): Promise<SavedSettings> => {
      const dirtyFields = form.formState.dirtyFields;
      const profileChanged = Boolean(dirtyFields.profile);
      const notificationsChanged = Boolean(dirtyFields.notifications);
      const appearanceChanged = Boolean(dirtyFields.appearance);
      let uploadedAvatarUrl: string | null = null;
      const requests: Promise<unknown>[] = [];

      if (profileChanged) {
        requests.push(updateProfileAPI(nextValues.profile));
      }
      if (notificationsChanged) {
        requests.push(saveNotificationPreferences(nextValues.notifications));
      }
      if (nextValues.avatarFile) {
        requests.push(
          uploadAvatar(nextValues.avatarFile).then((url) => {
            uploadedAvatarUrl = url;
          }),
        );
      }

      await Promise.all(requests);

      if (appearanceChanged) {
        await loadLanguage(nextValues.appearance.language);
        await i18n.changeLanguage(nextValues.appearance.language);
        setPersistedViewMode(nextValues.appearance.viewMode);
      }

      return {
        values: {
          ...nextValues,
          profile: {
            ...nextValues.profile,
            avatarUrl: uploadedAvatarUrl ?? nextValues.profile.avatarUrl,
          },
          avatarFile: null,
        },
        profileChanged: profileChanged || Boolean(uploadedAvatarUrl),
        notificationsChanged,
      };
    },
    onSuccess: ({ values: savedValues, profileChanged, notificationsChanged }) => {
      if (profileChanged) {
        saveProfile(savedValues.profile);
        queryClient.setQueryData(queryKeys.user.all, savedValues.profile);
      }
      if (notificationsChanged) {
        queryClient.setQueryData(
          notificationQueryKey,
          savedValues.notifications,
        );
      }
      initialValuesRef.current = savedValues;
      form.reset(savedValues);
      clearAvatarPreview();
      toast({
        variant: "success",
        description: t("settings.saveSuccess"),
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: t("settings.saveError"),
      });
    },
  });

  const updateProfile = useCallback(
    (updates: Partial<UserProfile>) => {
      form.setValue(
        "profile",
        { ...form.getValues("profile"), ...updates },
        { shouldDirty: true },
      );
    },
    [form],
  );

  const updateNotification = useCallback(
    (key: NotificationPreferenceKey, enabled: boolean) => {
      form.setValue(`notifications.${key}`, enabled, { shouldDirty: true });
    },
    [form],
  );

  const updateAppearance = useCallback(
    (updates: Partial<AppearanceSettingsDraft>) => {
      const nextAppearance = {
        ...form.getValues("appearance"),
        ...updates,
      };
      form.setValue("appearance", nextAppearance, { shouldDirty: true });
    },
    [form],
  );

  const selectAvatar = useCallback(
    (file: File) => {
      if (avatarPreviewUrlRef.current) {
        URL.revokeObjectURL(avatarPreviewUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(file);
      avatarPreviewUrlRef.current = previewUrl;
      setAvatarPreviewUrl(previewUrl);
      form.setValue("avatarFile", file, { shouldDirty: true });
    },
    [form],
  );

  const cancel = useCallback(() => {
    form.reset(initialValuesRef.current);
    clearAvatarPreview();
  }, [clearAvatarPreview, form]);

  const save = form.handleSubmit((nextValues) => {
    saveMutation.mutate(nextValues);
  });

  return {
    values: {
      profile,
      notifications,
      appearance,
    },
    avatarPreviewUrl,
    isDirty: form.formState.isDirty,
    isLoading: profileQuery.isLoading || notificationQuery.isLoading,
    isNotificationError: notificationQuery.isError,
    isSaving: saveMutation.isPending,
    updateProfile,
    updateNotification,
    updateAppearance,
    selectAvatar,
    retryNotifications: notificationQuery.refetch,
    cancel,
    save,
  };
}
