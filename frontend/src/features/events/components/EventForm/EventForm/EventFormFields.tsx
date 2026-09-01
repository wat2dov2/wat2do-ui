import { useTranslation } from "react-i18next";
import { LocationPin, DollarSign, Utensils, Plus, Trash2, ExternalLink } from "@/shared/ui/doodle-icons";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/shared/ui/field";
import { Switch } from "@/shared/ui/switch";
import { Button } from "@/shared/ui/button";
import { getEventCategories } from "@/shared/data/eventCategories";
import { translateCategory } from "@/shared/utils/event";
import { FormDateTimePicker, FormInput, FormSelect, FormTextarea } from "@/shared/ui/form-field";
import { TagInput } from "@/shared/ui/tag-input";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { OrganizationInput } from "@/features/events/components/OrganizationInput";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

export function EventFormFields() {
  const { t } = useTranslation();
  const {
    formData,
    updateField,
    errors,
    touched,
    handleBlur,
    organizations,
    updateOccurrence,
    addOccurrence,
    removeOccurrence,
    foodInput,
    setFoodInput,
    addFood,
    removeFood,
    imagePreview,
    isImageRequired,
    onImageUpload,
    onRemoveImage,
  } = useEventFormContext();

  return (
    <FieldGroup>
      <FieldSet>
        <FieldGroup>
          <FormInput
            name="title"
            label={t("events.eventTitle")}
            required
            value={formData.title}
            onChange={(value) => updateField("title", value as string)}
            onBlur={() => handleBlur("title")}
            placeholder={t("forms.eventTitlePlaceholder")}
            error={errors.title}
            touched={touched.title}
          />

          <OrganizationInput
            value={formData.organization_id}
            organizations={organizations}
            onChange={(organizationId) =>
              updateField("organization_id", organizationId)
            }
            onBlur={() => handleBlur("organization_id")}
            error={errors.organization_id}
            touched={touched.organization_id}
          />

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>
                {t("forms.occurrences")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Button
                type="button"
                onMouseDown={addOccurrence}
              >
                <Plus className="size-4" />
                {t("forms.addDate")}
              </Button>
            </div>
            <FieldGroup>
              {formData.occurrences.map((occurrence, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end"
                >
                  <FormDateTimePicker
                    name={`occurrences.${index}.dtstart_local`}
                    label={t("forms.startDateTime")}
                    required
                    value={occurrence.dtstart_local}
                    onChange={(value) => updateOccurrence(index, "dtstart_local", value)}
                    onBlur={() => handleBlur("occurrences")}
                    error={index === 0 ? errors.occurrences : undefined}
                    touched={touched.occurrences}
                  />
                  <FormDateTimePicker
                    name={`occurrences.${index}.dtend_local`}
                    label={t("forms.endDateTime")}
                    value={occurrence.dtend_local}
                    onChange={(value) => updateOccurrence(index, "dtend_local", value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onMouseDown={() => removeOccurrence(index)}
                    disabled={formData.occurrences.length === 1}
                    aria-label={t("forms.removeDate")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </FieldGroup>
          </Field>

          <FormInput
            name="location"
            label={t("filters.location")}
            required
            value={formData.location}
            onChange={(value) => updateField("location", value as string)}
            onBlur={() => handleBlur("location")}
            placeholder={t("forms.locationPlaceholder")}
            labelIcon={<LocationPin className="size-4" />}
            error={errors.location}
            touched={touched.location}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>{t("forms.optionalDetails")}</FieldLegend>
        <FieldGroup>
          <FormTextarea
            name="description"
            label={t("forms.description")}
            value={formData.description}
            onChange={(value) => updateField("description", value)}
            placeholder={t("forms.descriptionPlaceholder")}
            rows={2}
          />

          <FormInput
            name="source_url"
            label={t("forms.sourceUrl")}
            value={formData.source_url ?? ""}
            onChange={(value) => updateField("source_url", (value as string) || null)}
            placeholder={t("forms.sourceUrlPlaceholder")}
            labelIcon={<ExternalLink className="size-4" />}
          />

          <FieldGroup className="grid grid-cols-1 sm:grid-cols-2">
            <FormSelect
              name="category"
              label={t("filters.category")}
              value={formData.category}
              onChange={(value) => updateField("category", value)}
              placeholder={t("forms.selectCategory")}
              options={getEventCategories().map((cat) => ({ value: cat, label: translateCategory(cat, t) }))}
            />

            <FormInput
              name="price"
              label={t("filters.price")}
              type="number"
              value={formData.price}
              onChange={(value) => updateField("price", value as number)}
              placeholder={t("forms.pricePlaceholder")}
              step="0.01"
              min="0"
              prefix="$"
              labelIcon={<DollarSign className="size-4" />}
              inputClassName="text-secondary-foreground"
            />
          </FieldGroup>

          <TagInput
            label={t("forms.foodProvided")}
            labelIcon={<Utensils className="size-4" />}
            value={formData.food}
            inputValue={foodInput}
            onInputChange={setFoodInput}
            onAdd={addFood}
            onRemove={removeFood}
            placeholder={t("forms.foodPlaceholder")}
            tagColor="warning"
          />

          <Field>
            <FieldLabel htmlFor="registration">
              {t("forms.registration")}
            </FieldLabel>
            <div className="w-fit">
              <Switch
                id="registration"
                checked={formData.registration}
                onCheckedChange={(checked) =>
                  updateField("registration", checked)
                }
              />
            </div>
          </Field>

          <ImageUploadField
            label={t("forms.eventImage")}
            required={isImageRequired}
            imagePreview={imagePreview}
            onImageUpload={onImageUpload}
            onRemoveImage={onRemoveImage}
            previewVariant="poster"
            error={
              isImageRequired && !imagePreview
                ? t("qrCode.posterImageRequired")
                : undefined
            }
          />
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  );
}
