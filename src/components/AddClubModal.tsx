import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Users, Tag, Link, Instagram, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "./ui/field";
import { SuccessAlert } from "./ui/success-alert";
import type { Club } from "@/types";

interface AddClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (club: Club) => void;
  initialData?: Club;
}

export function AddClubModal({
  isOpen,
  onClose,
  onSave,
  initialData,
}: AddClubModalProps) {
  const { t } = useTranslation();
  const isEditMode = !!initialData;
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [formData, setFormData] = useState({
    club_name: "",
    categories: [] as string[],
    club_page: "",
    ig: "",
    discord: "",
    club_type: "WUSA",
  });

  const [categoryInput, setCategoryInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pre-fill form if editing
  useEffect(() => {
    if (isEditMode && initialData) {
      setFormData({
        club_name: initialData.club_name,
        categories: initialData.categories,
        club_page: initialData.club_page,
        ig: initialData.ig || "",
        discord: initialData.discord || "",
        club_type: initialData.club_type,
      });
    } else {
      setFormData({
        club_name: "",
        categories: [],
        club_page: "",
        ig: "",
        discord: "",
        club_type: "WUSA",
      });
    }
    setCategoryInput("");
    setErrors({});
  }, [isOpen, isEditMode, initialData]);

  const addCategory = () => {
    if (categoryInput.trim() && !formData.categories.includes(categoryInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        categories: [...prev.categories, categoryInput.trim()],
      }));
      setCategoryInput("");
    }
  };

  const removeCategory = (category: string) => {
    setFormData((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c !== category),
    }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.club_name.trim()) {
      newErrors.club_name = "Club name is required";
    }

    if (formData.categories.length === 0) {
      newErrors.categories = "At least one category is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const club: Club = {
      id: initialData?.id || Date.now(),
      club_name: formData.club_name.trim(),
      categories: formData.categories,
      club_page: formData.club_page.trim(),
      ig: formData.ig.trim() || null,
      discord: formData.discord.trim() || null,
      club_type: formData.club_type,
    };

    onSave(club);
    setSuccessMessage(
      isEditMode
        ? `Club "${club.club_name}" has been updated.`
        : `Club "${club.club_name}" has been created successfully!`
    );
    setShowSuccessAlert(true);
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Club" : "Add Club"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update the club information below"
              : "Fill in the details to add a new club"}
          </DialogDescription>
        </DialogHeader>

        <form>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Required Information</FieldLegend>
              <FieldDescription>
                All fields marked with * are required
              </FieldDescription>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="club-name" className="text-sm font-medium text-foreground">
                    Club Name <span className="text-error">*</span>
                  </FieldLabel>
                  <Input
                    id="club-name"
                    type="text"
                    value={formData.club_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, club_name: e.target.value }))
                    }
                    placeholder="e.g., Computer Science Club"
                    className={errors.club_name ? "border-error" : ""}
                  />
                  {errors.club_name && (
                    <FieldError className="text-xs">{errors.club_name}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="category-input" className="text-sm font-medium text-foreground">
                    Categories <span className="text-error">*</span>
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="category-input"
                      type="text"
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCategory();
                        }
                      }}
                      placeholder={t("forms.addCategoryPlaceholder")}
                      className={errors.categories ? "border-error" : ""}
                    />
                    <Button type="button" onClick={addCategory}>
                      Add
                    </Button>
                  </div>
                  {formData.categories.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.categories.map((cat) => (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 bg-primary/20 text-primary text-xs px-2 py-1 rounded-full"
                        >
                          {cat}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeCategory(cat)}
                            className="hover:bg-primary/30 rounded-full p-0.5 h-auto w-auto"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                  {errors.categories && (
                    <FieldError className="text-xs">{errors.categories}</FieldError>
                  )}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Optional Details</FieldLegend>
              <FieldGroup>

          <Field>
            <FieldLabel htmlFor="club-type" className="text-sm font-medium text-foreground">
              Club Type
            </FieldLabel>
            <Select
              value={formData.club_type}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, club_type: value }))
              }
            >
              <SelectTrigger id="club-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WUSA">WUSA</SelectItem>
                <SelectItem value="Independent">{t("forms.independent")}</SelectItem>
                <SelectItem value="Other">{t("forms.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="club-page" className="text-sm font-medium text-foreground">
              Club Page URL
            </FieldLabel>
            <Input
              id="club-page"
              type="text"
              value={formData.club_page}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, club_page: e.target.value }))
              }
              placeholder="e.g., https://example.com or 123"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="instagram-handle" className="text-sm font-medium text-foreground">
              Instagram Handle
            </FieldLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="instagram-handle"
                type="text"
                value={formData.ig}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, ig: e.target.value }))
                }
                placeholder={t("modals.signIn.username")}
                className="pl-7"
              />
            </div>
          </Field>

                <Field>
                  <FieldLabel htmlFor="discord-link" className="text-sm font-medium text-foreground">
                    Discord Link
                  </FieldLabel>
                  <Input
                    id="discord-link"
                    type="text"
                    value={formData.discord}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, discord: e.target.value }))
                    }
                    placeholder={t("forms.discordPlaceholder")}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <Field orientation="horizontal">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="button" onClick={handleSubmit}>
                {isEditMode ? "Update Club" : "Add Club"}
              </Button>
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter className="sr-only">
          <DialogClose asChild>
            <Button variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit}>
            {isEditMode ? "Update Club" : "Add Club"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SuccessAlert
      isOpen={showSuccessAlert}
      onClose={() => {
        setShowSuccessAlert(false);
        onClose();
      }}
      title={isEditMode ? t("clubs.clubUpdated") : t("clubs.clubCreated")}
      message={successMessage}
    />
    </>
  );
}
