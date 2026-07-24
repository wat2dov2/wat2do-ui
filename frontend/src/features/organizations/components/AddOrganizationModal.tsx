import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
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
  FormActions,
  FormGrid,
  FormLayout,
  FormSection,
} from "@/shared/layout";
import { MultiSelect } from "@/shared/ui/multi-select";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { toast } from "@/shared/hooks/use-toast";
import { useForm } from "@/shared/hooks/useForm";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { getOrganizationCategories } from "@/shared/data/organizationCategories";
import {
  getSchoolOrganizationType,
  INDEPENDENT_ORGANIZATION_TYPE,
} from "@/shared/data/organizationTypeAssets";
import { translateCategory } from "@/shared/utils/event";
import type { Organization } from "@/shared/types";

interface OrganizationFormData {
  organization_name: string;
  categories: string[];
  organization_page: string;
  ig: string;
  discord: string;
  organization_type: string;
  school: string;
}

type SaveOrganization = (
  organization: Organization,
) => Organization | void | Promise<Organization | void>;

interface OrganizationFormProps {
  onSave: SaveOrganization;
  /** Omit to hide the Cancel action (pages navigate back from their header instead). */
  onCancel?: () => void;
  onSaved?: (organization: Organization) => void;
  initialData?: Organization;
  defaultSchool?: string;
  allowSchoolSelection?: boolean;
  active?: boolean;
  showHeading?: boolean;
}

export function OrganizationForm({
  onSave,
  onCancel,
  onSaved,
  initialData,
  defaultSchool = DEFAULT_SCHOOL,
  allowSchoolSelection = true,
  active = true,
  showHeading = true,
}: OrganizationFormProps) {
  const { t } = useTranslation();
  const isEditMode = initialData != null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDefaults = useCallback(
    () => ({
      organization_name: "",
      categories: [],
      organization_page: "",
      ig: "",
      discord: "",
      organization_type: INDEPENDENT_ORGANIZATION_TYPE,
      school: defaultSchool,
    }),
    [defaultSchool],
  );

  const validate = useCallback(
    (data: OrganizationFormData, touched: Record<string, boolean>) => {
      const errors: Record<string, string> = {};
      if (touched.organization_name && !data.organization_name.trim()) {
        errors.organization_name = t("forms.organizationNameRequired");
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

  const form = useForm<OrganizationFormData>({
    initialData: initialData
      ? {
          organization_name: initialData.organization_name,
          categories: initialData.categories,
          organization_page: initialData.organization_page,
          ig: initialData.ig || "",
          discord: initialData.discord || "",
          organization_type: initialData.organization_type,
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

    const organization: Organization = {
      id: initialData?.id || Date.now(),
      // The backend owns review state; edits never change it.
      status: initialData?.status ?? "pending",
      organization_name: form.formData.organization_name.trim(),
      categories: form.formData.categories,
      organization_page: form.formData.organization_page.trim(),
      ig: form.formData.ig.trim() || null,
      discord: form.formData.discord.trim() || null,
      organization_type: form.formData.organization_type,
      created_by: initialData?.created_by || null,
      school: form.formData.school,
    };

    setIsSubmitting(true);
    try {
      const savedOrganization =
        (await Promise.resolve(onSave(organization))) || organization;
      toast({
        title: isEditMode
          ? t("organizations.clubUpdated")
          : t("organizations.clubCreated"),
        description: isEditMode
          ? t("organizations.clubUpdatedMessage", {
              name: savedOrganization.organization_name,
            })
          : t("organizations.clubCreatedMessage", {
              name: savedOrganization.organization_name,
            }),
        variant: "success",
      });
      onSaved?.(savedOrganization);
    } catch (error) {
      console.error("Failed to save organization:", error);
      toast({
        title: t("common.error"),
        description: t("organizations.saveFailed"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSchoolChange = (school: string) => {
    const currentMappedType = getSchoolOrganizationType(form.formData.school);
    const nextMappedType = getSchoolOrganizationType(school);
    const wasUsingMappedType =
      currentMappedType === form.formData.organization_type;

    form.updateField("school", school);
    if (wasUsingMappedType) {
      form.updateField(
        "organization_type",
        nextMappedType ?? INDEPENDENT_ORGANIZATION_TYPE,
      );
    }
  };

  const mappedOrganizationType = getSchoolOrganizationType(
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
            ? t("organizations.editClub")
            : t("organizations.addClub")}
        </h2>
      ) : null}

      <FormSection title={t("organizations.organizationDetails")}>
        <FormGrid>
          <Field>
            <FieldLabel htmlFor="club-name">
              {t("forms.organizationName")}
            </FieldLabel>
            <Input
              id="club-name"
              value={form.formData.organization_name}
              onChange={(event) =>
                form.updateField("organization_name", event.target.value)
              }
              onBlur={() => form.handleBlur("organization_name")}
              placeholder={t("forms.organizationNamePlaceholder")}
              aria-invalid={Boolean(form.errors.organization_name)}
            />
            {form.errors.organization_name ? (
              <FieldError>{form.errors.organization_name}</FieldError>
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
            options={getOrganizationCategories()}
            selected={form.formData.categories}
            onToggle={toggleCategory}
            className="justify-start"
            getLabel={(category) => translateCategory(category, t)}
          />
          {form.touched.categories && form.errors.categories ? (
            <FieldError>{form.errors.categories}</FieldError>
          ) : null}
        </Field>
      </FormSection>

      <FormSection
        title={t("forms.optionalDetails")}
        description={t("organizations.optionalDetailsDescription")}
      >
        <FormGrid>
          <Field>
            <FieldLabel htmlFor="club-organization-type">
              {t("forms.organizationType")}
            </FieldLabel>
            <Select
              value={form.formData.organization_type}
              onValueChange={(value) =>
                form.updateField("organization_type", value)
              }
            >
              <SelectTrigger id="club-organization-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mappedOrganizationType ? (
                  <SelectItem value={mappedOrganizationType}>
                    {t("forms.organizationTypeMapped", {
                      type: mappedOrganizationType.toUpperCase(),
                    })}
                  </SelectItem>
                ) : null}
                <SelectItem value={INDEPENDENT_ORGANIZATION_TYPE}>
                  {t("forms.organizationTypeIndependent")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="club-page">
              {t("forms.organizationPageUrl")}
            </FieldLabel>
            <Input
              id="club-page"
              value={form.formData.organization_page}
              onChange={(event) =>
                form.updateField("organization_page", event.target.value)
              }
              placeholder={t("forms.organizationPageUrlPlaceholder")}
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
        {onCancel ? (
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <LoadingButton
          type="submit"
          isLoading={isSubmitting}
          loadingText={t("common.pleaseWait")}
        >
          {isEditMode
            ? t("organizations.updateClub")
            : t("organizations.addClub")}
        </LoadingButton>
      </FormActions>
    </FormLayout>
  );
}

interface AddOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: SaveOrganization;
  initialData?: Organization;
}

export function AddOrganizationModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: AddOrganizationModalProps) {
  const { t } = useTranslation();
  const isEditMode = initialData != null;

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="overflow-hidden p-0" aria-describedby={undefined}>
        <DrawerClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </DrawerClose>
        <DrawerHeader className="sr-only">
          <DrawerTitle>
            {isEditMode
              ? t("organizations.editClub")
              : t("organizations.addClub")}
          </DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[92dvh] overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <OrganizationForm
            onSave={onSave}
            onCancel={onClose}
            onSaved={onClose}
            initialData={initialData}
            active={isOpen}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
