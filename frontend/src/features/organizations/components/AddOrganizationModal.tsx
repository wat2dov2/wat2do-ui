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
import type { Club } from "@/shared/types";
import { toast } from "@/shared/hooks/use-toast";
import { useForm } from "@/shared/hooks/useForm";
import { useTagInput } from "@/shared/hooks/useTagInput";
import { useModalState } from "@/shared/hooks/useModalState";
import { TagInput } from "@/shared/ui/tag-input";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { SchoolCombobox } from "@/shared/ui/school-combobox";

interface ClubFormData {
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
  onSave: (club: Club) => void | Promise<void>;
  initialData?: Club;
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
  const validate = useCallback((data: ClubFormData, touched: Record<string, boolean>) => {
    const newErrors: Record<string, string> = {};
    if (touched.club_name && !data.club_name.trim()) {
      newErrors.club_name = t("forms.clubNameRequired");
    }
    if (touched.categories && data.categories.length === 0) {
      newErrors.categories = t("forms.categoryRequired");
    }
    if (touched.school && !data.school) {
      newErrors.school = t("forms.schoolRequired");
    }
    return newErrors;
  }, [t]);

  const form = useForm<ClubFormData>({
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

  // Use tag input hook to manage category input state
  const categoryInput = useTagInput({
    onAdd: (value) => {
      if (!form.formData.categories.includes(value)) {
        form.updateField("categories", [...form.formData.categories, value]);
        form.handleBlur("categories");
      }
    },
  });

  // Use modal state hook for standardized open/close handling
  // Combined reset function for form and category input
  const combinedReset = useCallback(() => {
    form.reset();
    categoryInput.reset();
  }, [form, categoryInput]);

  const modalState = useModalState({ 
    onClose,
    resetOnClose: true,
    resetFn: combinedReset,
  });

  const addCategory = useCallback(() => {
    categoryInput.handleAdd();
  }, [categoryInput]);

  const removeCategory = (index: number) => {
    form.updateField(
      "categories",
      form.formData.categories.filter((_, i) => i !== index)
    );
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    Object.keys(form.formData).forEach((key) => {
      form.handleBlur(key);
    });

    if (!form.isValid) return;

    const club: Club = {
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
      await Promise.resolve(onSave(club));
      toast({
        title: isEditMode ? t("organizations.clubUpdated") : t("organizations.clubCreated"),
        description: isEditMode
          ? t("organizations.clubUpdatedMessage", { name: club.club_name })
          : t("organizations.clubCreatedMessage", { name: club.club_name }),
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t("organizations.editClub") : t("organizations.addClub")}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? t("organizations.editClubDescription")
              : t("organizations.addClubDescription")}
          </DialogDescription>
        </DialogHeader>

        <form>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>{t("forms.requiredInformation")}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="club-name" className="text-sm font-medium text-foreground">
                    {t("forms.clubName")} <span className="text-error">*</span>
                  </FieldLabel>
                  <Input
                    id="club-name"
                    type="text"
                    value={form.formData.club_name}
                    onChange={(e) => form.updateField("club_name", e.target.value)}
                    onBlur={() => form.handleBlur("club_name")}
                    placeholder={t("forms.clubNamePlaceholder")}
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

                <TagInput
                  label={t("forms.categories")}
                  value={form.formData.categories}
                  inputValue={categoryInput.inputValue}
                  onInputChange={categoryInput.setInputValue}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                  placeholder={t("forms.addCategoryPlaceholder")}
                  error={form.errors.categories}
                  touched={!!form.touched.categories}
                  tagColor="primary"
                  required
                />
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
              {t("forms.clubType")}
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
              {t("forms.clubPageUrl")}
            </FieldLabel>
              <Input
                id="club-page"
                type="text"
                value={form.formData.club_page}
                onChange={(e) => form.updateField("club_page", e.target.value)}
                placeholder={t("forms.clubPageUrlPlaceholder")}
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
                onClick={handleSubmit}
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
            onClick={handleSubmit}
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
