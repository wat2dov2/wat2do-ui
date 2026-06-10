import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/shared/ui/dialog";
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
  FieldDescription,
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
import { MultiSelect } from "@/shared/ui/multi-select";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { getOrganizationCategories } from "@/shared/data/organizationCategories";
import { getClubCategoryTranslation } from "@/shared/utils/categoryTranslation";

interface OrganizationFormData {
  club_name: string;
  categories: string[];
  club_page: string;
  ig: string;
  discord: string;
  club_type: string;
  owner_user_id: string;
  school: string;
}

interface AddOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (organization: Organization) => void | Promise<void>;
  initialData?: Organization;
}

export function AddOrganizationModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: AddOrganizationModalProps) {
  const { t } = useTranslation();
  const isEditMode = !!initialData;

  // Memoize getDefaults to prevent infinite loops
  const getDefaults = useCallback(() => ({
    club_name: "",
    categories: [],
    club_page: "",
    ig: "",
    discord: "",
    club_type: "WUSA",
    owner_user_id: "",
    school: DEFAULT_SCHOOL,
  }), []);

  // Memoize validate to prevent infinite loops
  const validate = useCallback((data: OrganizationFormData, touched: Record<string, boolean>) => {
    const newErrors: Record<string, string> = {};
    if (touched.club_name && !data.club_name.trim()) {
      newErrors.club_name = t("forms.organizationNameRequired");
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
          club_name: initialData.club_name,
          categories: initialData.categories,
          club_page: initialData.club_page,
          ig: initialData.ig || "",
          discord: initialData.discord || "",
          club_type: initialData.club_type,
          owner_user_id: initialData.created_by || "",
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

  const toggleCategory = useCallback(
    (category: string) => {
      const current = form.formData.categories;
      const next = current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category];
      form.updateField("categories", next);
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
      club_name: form.formData.club_name.trim(),
      categories: form.formData.categories,
      club_page: form.formData.club_page.trim(),
      ig: form.formData.ig.trim() || null,
      discord: form.formData.discord.trim() || null,
      club_type: form.formData.club_type,
      created_by: form.formData.owner_user_id.trim() || initialData?.created_by || null,
      school: form.formData.school,
    };

    setIsSubmitting(true);
    try {
      await Promise.resolve(onSave(organization));
      toast({
        title: isEditMode ? t("organizations.clubUpdated") : t("organizations.clubCreated"),
        description: isEditMode
          ? t("organizations.clubUpdatedMessage", { name: organization.club_name })
          : t("organizations.clubCreatedMessage", { name: organization.club_name }),
        variant: "success",
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{isEditMode ? t("organizations.editClub") : t("organizations.addClub")}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? t("organizations.editClubDescription")
              : t("organizations.addClubDescription")}
          </DialogDescription>
        </DialogHeader>

        <form className="overflow-y-auto flex-1 min-h-0 px-6 pb-6 pt-2">
          <FieldGroup>
            <FieldSet>
              <FieldLegend>{t("forms.requiredInformation")}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="club-name" className="text-sm font-medium text-foreground">
                    {t("forms.organizationName")} <span className="text-error">*</span>
                  </FieldLabel>
                  <Input
                    id="club-name"
                    type="text"
                    value={form.formData.club_name}
                    onChange={(e) => form.updateField("club_name", e.target.value)}
                    onBlur={() => form.handleBlur("club_name")}
                    placeholder={t("forms.organizationNamePlaceholder")}
                    className={form.errors.club_name ? "border-error" : ""}
                  />
                  {form.errors.club_name && (
                    <FieldError className="text-xs">{form.errors.club_name}</FieldError>
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
                    options={getOrganizationCategories()}
                    selected={form.formData.categories}
                    onToggle={toggleCategory}
                    className="justify-start"
                    getLabel={(category) => getClubCategoryTranslation(category, t)}
                  />
                  {form.touched.categories && form.errors.categories && (
                    <FieldError className="text-xs">{form.errors.categories}</FieldError>
                  )}
                </Field>
                {!isEditMode && (
                  <Field>
                    <FieldLabel htmlFor="owner-user-id" className="text-sm font-medium text-foreground">
                      {t("forms.ownerUserId")}
                    </FieldLabel>
                    <Input
                      id="owner-user-id"
                      type="text"
                      value={form.formData.owner_user_id}
                      onChange={(e) => form.updateField("owner_user_id", e.target.value)}
                      placeholder={t("forms.ownerUserIdPlaceholder")}
                    />
                    <FieldDescription>
                      {t("forms.ownerUserIdDescription")}
                    </FieldDescription>
                  </Field>
                )}
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
              value={form.formData.club_type}
              onValueChange={(value) => form.updateField("club_type", value)}
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
                value={form.formData.club_page}
                onChange={(e) => form.updateField("club_page", e.target.value)}
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
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
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

        <DialogFooter className="sr-only">
          <DialogClose asChild>
            <Button variant="outline">
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            onMouseDown={handleSubmit}
            isLoading={isSubmitting}
            loadingText={t("common.pleaseWait") || "Please wait..."}
          >
            {isEditMode ? t("organizations.updateClub") : t("organizations.addClub")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
