import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
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
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/shared/ui/field";
import type { Organization } from "@/shared/types";
import { toast } from "@/shared/hooks/use-toast";
import { useForm } from "@/shared/hooks/useForm";
import { useModalState } from "@/shared/hooks/useModalState";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@/shared/ui/multi-select";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { getOrganizationCategories } from "@/shared/data/organizationCategories";
import { translateCategory } from "@/shared/utils/event";

interface OrganizationFormData {
  organization_name: string;
  categories: string[];
  organization_page: string;
  ig: string;
  discord: string;
  organization_type: string;
  school: string;
}

interface AddOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (organization: Organization) => void | Promise<void>;
  initialData?: Organization;
  onBack?: () => void;
}

export function AddOrganizationModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  onBack,
}: AddOrganizationModalProps) {
  const { t } = useTranslation();
  const isEditMode = !!initialData;

  // Memoize getDefaults to prevent infinite loops
  const getDefaults = useCallback(() => ({
    organization_name: "",
    categories: [],
    organization_page: "",
    ig: "",
    discord: "",
    organization_type: "WUSA",
    school: DEFAULT_SCHOOL,
  }), []);

  // Memoize validate to prevent infinite loops
  const validate = useCallback((data: OrganizationFormData, touched: Record<string, boolean>) => {
    const newErrors: Record<string, string> = {};
    if (touched.organization_name && !data.organization_name.trim()) {
      newErrors.organization_name = t("forms.organizationNameRequired");
    }
    if (touched.categories && data.categories.length === 0) {
      newErrors.categories = t("forms.categoryRequired");
    }
    if (touched.school && !data.school) {
      newErrors.school = t("forms.schoolRequired");
    }
    return newErrors;
  }, [t]);

  const form = useForm<OrganizationFormData>({
    initialData: initialData
      ? {
          organization_name: initialData.organization_name,
          categories: initialData.categories,
          organization_page: initialData.organization_page,
          ig: initialData.ig || "",
          discord: initialData.discord || "",
          organization_type: initialData.organization_type,
          school: initialData.school || DEFAULT_SCHOOL,
        }
      : undefined,
    isEditMode,
    isOpen,
    getDefaults,
    validate,
  });

  const modalState = useModalState({
    onClose,
    resetOnClose: true,
    resetFn: form.reset,
  });

  const handleCategoriesChange = useCallback(
    (categories: string[]) => {
      form.updateField("categories", categories);
      form.handleBlur("categories");
    },
    [form],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    Object.keys(form.formData).forEach((key) => {
      form.handleBlur(key);
    });

    if (!form.isValid) return;

    const organization: Organization = {
      id: initialData?.id || Date.now(),
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
      await Promise.resolve(onSave(organization));
      toast({
        title: isEditMode ? t("organizations.clubUpdated") : t("organizations.clubCreated"),
        description: isEditMode
          ? t("organizations.clubUpdatedMessage", { name: organization.organization_name })
          : t("organizations.clubCreatedMessage", { name: organization.organization_name }),
        variant: "success",
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={modalState.handleOpenChange}>
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
        <div className="max-h-[92dvh] overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <form className="space-y-6">
            <DrawerHeader className="p-0 pr-11 text-left">
              <div
                className={`flex min-h-9 gap-2 ${isEditMode ? "items-start" : "items-center"}`}
              >
                {onBack && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onMouseDown={onBack}
                    aria-label={t("common.back")}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                <div className="min-w-0">
                  <DrawerTitle className="text-lg font-semibold leading-none text-foreground sm:text-xl">
                    {isEditMode ? t("organizations.editClub") : t("organizations.addClub")}
                  </DrawerTitle>
                  {isEditMode && (
                    <DrawerDescription className="mt-1.5 text-sm text-muted-foreground">
                      {t("organizations.editClubDescription")}
                    </DrawerDescription>
                  )}
                </div>
              </div>
            </DrawerHeader>
            <FieldGroup>
              <FieldSet>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="club-name" className="text-sm font-medium text-foreground">
                      {t("forms.organizationName")} <span className="text-error">*</span>
                    </FieldLabel>
                    <Input
                      id="club-name"
                      type="text"
                      value={form.formData.organization_name}
                      onChange={(e) => form.updateField("organization_name", e.target.value)}
                      onBlur={() => form.handleBlur("organization_name")}
                      placeholder={t("forms.organizationNamePlaceholder")}
                      className={form.errors.organization_name ? "border-error" : ""}
                    />
                    {form.errors.organization_name && (
                      <FieldError className="text-xs">{form.errors.organization_name}</FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="club-school" className="text-sm font-medium text-foreground">
                      {t("schools.school")} <span className="text-error">*</span>
                    </FieldLabel>
                    <SchoolCombobox
                      id="club-school"
                      value={form.formData.school || ""}
                      onChange={(value) => form.updateField("school", value)}
                      variant="field"
                      placeholder={t("schools.selectSchool")}
                    />
                    {form.errors.school && (
                      <FieldError className="text-xs">{form.errors.school}</FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel className="text-sm font-medium text-foreground">
                      {t("forms.categories")} <span className="text-error">*</span>
                    </FieldLabel>
                    <MultiSelect
                      values={form.formData.categories}
                      onValuesChange={handleCategoriesChange}
                    >
                      <MultiSelectTrigger className="w-full">
                        <MultiSelectValue placeholder={t("forms.selectCategories")} />
                      </MultiSelectTrigger>
                      <MultiSelectContent>
                        <MultiSelectGroup>
                          {getOrganizationCategories().map((category) => (
                            <MultiSelectItem key={category} value={category}>
                              {translateCategory(category, t)}
                            </MultiSelectItem>
                          ))}
                        </MultiSelectGroup>
                      </MultiSelectContent>
                    </MultiSelect>
                    {form.touched.categories && form.errors.categories && (
                      <FieldError className="text-xs">{form.errors.categories}</FieldError>
                    )}
                  </Field>
                </FieldGroup>
              </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>{t("forms.optionalDetails")}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="club-type" className="text-sm font-medium text-foreground">
                    {t("forms.organizationType")}
                  </FieldLabel>
                  <Select
                    value={form.formData.organization_type}
                    onValueChange={(value) => form.updateField("organization_type", value)}
                  >
                    <SelectTrigger id="club-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WUSA">{t("forms.wusa")}</SelectItem>
                      <SelectItem value="Independent">{t("forms.independent")}</SelectItem>
                      <SelectItem value="Other">{t("forms.other")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="club-page" className="text-sm font-medium text-foreground">
                    {t("forms.organizationPageUrl")}
                  </FieldLabel>
                  <Input
                    id="club-page"
                    type="text"
                    value={form.formData.organization_page}
                    onChange={(e) => form.updateField("organization_page", e.target.value)}
                    placeholder={t("forms.organizationPageUrlPlaceholder")}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="instagram-handle" className="text-sm font-medium text-foreground">
                    {t("forms.instagramHandle")}
                  </FieldLabel>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      @
                    </span>
                    <Input
                      id="instagram-handle"
                      type="text"
                      value={form.formData.ig}
                      onChange={(e) => form.updateField("ig", e.target.value)}
                      placeholder={t("modals.signIn.username")}
                      className="pl-7"
                    />
                  </div>
                </Field>

                <Field>
                  <FieldLabel htmlFor="discord-link" className="text-sm font-medium text-foreground">
                    {t("forms.discordLink")}
                  </FieldLabel>
                  <Input
                    id="discord-link"
                    type="text"
                    value={form.formData.discord}
                    onChange={(e) => form.updateField("discord", e.target.value)}
                    placeholder={t("forms.discordPlaceholder")}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <Field orientation="horizontal">
              <DrawerClose asChild>
                <Button variant="outline" type="button">
                  {t("common.cancel")}
                </Button>
              </DrawerClose>
              <LoadingButton
                type="button"
                onMouseDown={handleSubmit}
                isLoading={isSubmitting}
                loadingText={t("common.pleaseWait") || "Please wait..."}
              >
                {isEditMode ? t("organizations.updateClub") : t("organizations.addClub")}
              </LoadingButton>
            </Field>
            </FieldGroup>
          </form>

          <DrawerFooter className="sr-only">
            <DrawerClose asChild>
              <Button variant="outline">
                {t("common.cancel")}
              </Button>
            </DrawerClose>
            <LoadingButton
              onMouseDown={handleSubmit}
              isLoading={isSubmitting}
              loadingText={t("common.pleaseWait") || "Please wait..."}
            >
              {isEditMode ? t("organizations.updateClub") : t("organizations.addClub")}
            </LoadingButton>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
