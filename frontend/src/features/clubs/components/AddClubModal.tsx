import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import {
  DrawerBody,
  FormActions,
  FormGrid,
  FormLayout,
  FormSection,
  Stack,
} from "@/shared/layout";
import { MultiSelect } from "@/shared/ui/multi-select";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { toast } from "@/shared/hooks/use-toast";
import { useForm } from "@/shared/hooks/useForm";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import {
  getSchoolClubType,
  INDEPENDENT_CLUB_TYPE,
} from "@/shared/data/clubTypeAssets";
import { translateCategory } from "@/shared/utils/event";
import type { Club } from "@/shared/types";

interface ClubFormData {
  club_name: string;
  categories: string[];
  club_page: string;
  ig: string;
  discord: string;
  club_type: string;
  school: string;
}

type SaveClub = (
  club: Club,
) => Club | void | Promise<Club | void>;

interface ClubFormProps {
  onSave: SaveClub;
  /** Omit to hide the Cancel action (pages navigate back from their header instead). */
  onSaved?: (club: Club) => void;
  initialData?: Club;
  defaultSchool?: string;
  allowSchoolSelection?: boolean;
  active?: boolean;
  showHeading?: boolean;
}

export function ClubForm({
  onSave,
  onSaved,
  initialData,
  defaultSchool = DEFAULT_SCHOOL,
  allowSchoolSelection = true,
  active = true,
  showHeading = true,
}: ClubFormProps) {
  const { club_categories: clubCategories } = useAppConstants();
  const { t } = useTranslation();
  const isEditMode = initialData != null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDefaults = useCallback(
    () => ({
      club_name: "",
      categories: [],
      club_page: "",
      ig: "",
      discord: "",
      club_type: INDEPENDENT_CLUB_TYPE,
      school: defaultSchool,
    }),
    [defaultSchool],
  );

  const validate = useCallback(
    (data: ClubFormData, touched: Record<string, boolean>) => {
      const errors: Record<string, string> = {};
      if (touched.club_name && !data.club_name.trim()) {
        errors.club_name = t("forms.clubNameRequired");
      }
      if (touched.categories && data.categories.length === 0) {
        errors.categories = t("forms.categoryRequired");
      }
      if (touched.school && !data.school) {
        errors.school = t("forms.schoolRequired");
      }
      return errors;
    },
    [t],
  );

  const form = useForm<ClubFormData>({
    initialData: initialData
      ? {
          club_name: initialData.club_name,
          categories: initialData.categories,
          club_page: initialData.club_page,
          ig: initialData.ig || "",
          discord: initialData.discord || "",
          club_type: initialData.club_type,
          school: initialData.school || defaultSchool,
        }
      : undefined,
    isEditMode,
    isOpen: active,
    getDefaults,
    validate,
  });

  const toggleCategory = useCallback(
    (category: string) => {
      const categories = form.formData.categories.includes(category)
        ? form.formData.categories.filter((value) => value !== category)
        : [...form.formData.categories, category];
      form.updateField("categories", categories);
      form.handleBlur("categories");
    },
    [form],
  );

  const handleSubmit = async () => {
    Object.keys(form.formData).forEach(form.handleBlur);
    if (!form.isValid) return;

    const club: Club = {
      id: initialData?.id || Date.now(),
      // The backend owns review state; edits never change it.
      status: initialData?.status ?? "pending",
      club_name: form.formData.club_name.trim(),
      categories: form.formData.categories,
      club_page: form.formData.club_page.trim(),
      ig: form.formData.ig.trim() || null,
      discord: form.formData.discord.trim() || null,
      club_type: form.formData.club_type,
      created_by: initialData?.created_by || null,
      school: form.formData.school,
    };

    setIsSubmitting(true);
    try {
      const savedClub =
        (await Promise.resolve(onSave(club))) || club;
      toast({
        title: isEditMode
          ? t("clubs.clubUpdated")
          : t("clubs.clubCreated"),
        description: isEditMode
          ? t("clubs.clubUpdatedMessage", {
              name: savedClub.club_name,
            })
          : t("clubs.clubCreatedMessage", {
              name: savedClub.club_name,
            }),
        variant: "success",
      });
      onSaved?.(savedClub);
    } catch (error) {
      console.error("Failed to save club:", error);
      toast({
        title: t("common.error"),
        description: t("clubs.saveFailed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSchoolChange = (school: string) => {
    const currentMappedType = getSchoolClubType(form.formData.school);
    const nextMappedType = getSchoolClubType(school);
    const wasUsingMappedType =
      currentMappedType === form.formData.club_type;

    form.updateField("school", school);
    if (wasUsingMappedType) {
      form.updateField(
        "club_type",
        nextMappedType ?? INDEPENDENT_CLUB_TYPE,
      );
    }
  };

  const mappedClubType = getSchoolClubType(
    form.formData.school,
  );

  return (
    <FormLayout
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {showHeading ? (
        <h2 className="text-xl font-semibold text-foreground">
          {isEditMode
            ? t("clubs.editClub")
            : t("clubs.addClub")}
        </h2>
      ) : null}

      <Stack gap={5}>
        <FormGrid>
          <Field>
            <FieldLabel htmlFor="club-name">
              {t("forms.clubName")}
            </FieldLabel>
            <Input
              id="club-name"
              value={form.formData.club_name}
              onChange={(event) =>
                form.updateField("club_name", event.target.value)
              }
              onBlur={() => form.handleBlur("club_name")}
              placeholder={t("forms.clubNamePlaceholder")}
              aria-invalid={Boolean(form.errors.club_name)}
            />
            {form.errors.club_name ? (
              <FieldError>{form.errors.club_name}</FieldError>
            ) : null}
          </Field>

          {allowSchoolSelection ? (
            <Field>
              <FieldLabel htmlFor="club-school">
                {t("schools.school")}
              </FieldLabel>
              <SchoolCombobox
                id="club-school"
                value={form.formData.school}
                onChange={handleSchoolChange}
                variant="field"
                placeholder={t("schools.selectSchool")}
              />
              {form.errors.school ? (
                <FieldError>{form.errors.school}</FieldError>
              ) : null}
            </Field>
          ) : null}
        </FormGrid>

        <Field>
          <FieldLabel>{t("forms.categories")}</FieldLabel>
          <MultiSelect
            options={clubCategories}
            selected={form.formData.categories}
            onToggle={toggleCategory}
            className="justify-start"
            getLabel={(category) => translateCategory(category, t)}
          />
          {form.touched.categories && form.errors.categories ? (
            <FieldError>{form.errors.categories}</FieldError>
          ) : null}
        </Field>
      </Stack>

      <FormSection
        title={t("forms.optionalDetails")}
        description={t("clubs.optionalDetailsDescription")}
      >
        <FormGrid>
          <Field>
            <FieldLabel htmlFor="club-club-type">
              {t("forms.clubType")}
            </FieldLabel>
            <Select
              value={form.formData.club_type}
              onValueChange={(value) =>
                form.updateField("club_type", value)
              }
            >
              <SelectTrigger id="club-club-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mappedClubType ? (
                  <SelectItem value={mappedClubType}>
                    {t("forms.clubTypeMapped", {
                      type: mappedClubType.toUpperCase(),
                    })}
                  </SelectItem>
                ) : null}
                <SelectItem value={INDEPENDENT_CLUB_TYPE}>
                  {t("forms.clubTypeIndependent")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="club-page">
              {t("forms.clubPageUrl")}
            </FieldLabel>
            <Input
              id="club-page"
              value={form.formData.club_page}
              onChange={(event) =>
                form.updateField("club_page", event.target.value)
              }
              placeholder={t("forms.clubPageUrlPlaceholder")}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="instagram-handle">
              {t("forms.instagramHandle")}
            </FieldLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="instagram-handle"
                value={form.formData.ig}
                onChange={(event) =>
                  form.updateField("ig", event.target.value)
                }
                placeholder={t("modals.signIn.username")}
                className="pl-7"
              />
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="discord-link">
              {t("forms.discordLink")}
            </FieldLabel>
            <Input
              id="discord-link"
              value={form.formData.discord}
              onChange={(event) =>
                form.updateField("discord", event.target.value)
              }
              placeholder={t("forms.discordPlaceholder")}
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormActions>
        <LoadingButton
          type="submit"
          isLoading={isSubmitting}
          loadingText={t("common.pleaseWait")}
        >
          {isEditMode
            ? t("clubs.updateClub")
            : t("clubs.addClub")}
        </LoadingButton>
      </FormActions>
    </FormLayout>
  );
}

interface AddClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: SaveClub;
  initialData?: Club;
}

export function AddClubModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: AddClubModalProps) {
  const { t } = useTranslation();
  const isEditMode = initialData != null;

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="overflow-hidden p-0" aria-describedby={undefined}>
        <DrawerHeader className="sr-only">
          <DrawerTitle>
            {isEditMode
              ? t("clubs.editClub")
              : t("clubs.addClub")}
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="gap-0 px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <ClubForm
            onSave={onSave}
            onSaved={onClose}
            initialData={initialData}
            active={isOpen}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
