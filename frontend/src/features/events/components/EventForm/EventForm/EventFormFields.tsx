import { useTranslation } from "react-i18next";
import { MapPin, DollarSign, Utensils, Plus, Trash2 } from "lucide-react";
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
import { EVENT_CATEGORIES } from "@/shared/constants/eventCategories";
import { translateCategory } from "@/shared/utils/event";
import { FormDateTimePicker, FormInput, FormSelect, FormTextarea } from "@/shared/ui/form-field";
import { TagInput } from "@/shared/ui/tag-input";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

export function EventFormFields() {
  const { t } = useTranslation();
  const {
    formData,
    updateField,
    errors,
    touched,
    handleBlur,
    updateOccurrence,
    addOccurrence,
    removeOccurrence,
    foodInput,
    setFoodInput,
    addFood,
    removeFood,
    imagePreview,
    onImageUpload,
    onRemoveImage,
  } = useEventFormContext();

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>{t("forms.eventInformation")}</FieldLegend>
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

          <FormInput
            name="organization"
            label={t("events.organization")}
            required
            value={formData.organization}
            onChange={(value) => updateField("organization", value as string)}
            onBlur={() => handleBlur("organization")}
            placeholder={t("forms.organizationPlaceholder")}
            error={errors.organization}
            touched={touched.organization}
          />

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>
                {t("forms.occurrences")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOccurrence}
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
                    onClick={() => removeOccurrence(index)}
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
            labelIcon={<MapPin className="size-4" />}
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

          <FieldGroup className="grid grid-cols-2">
            <FormSelect
              name="category"
              label={t("filters.category")}
              value={formData.category}
              onChange={(value) => updateField("category", value)}
              placeholder={t("forms.selectCategory")}
              options={EVENT_CATEGORIES.map((cat) => ({ value: cat, label: translateCategory(cat, t) }))}
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
            <FieldLabel htmlFor="requires-registration">
              {t("forms.requiresRegistration")}
            </FieldLabel>
            <div className="w-fit">
              <Switch
                id="requires-registration"
                checked={formData.requiresRegistration}
                onCheckedChange={(checked) =>
                  updateField("requiresRegistration", checked)
                }
              />
            </div>
          </Field>

          <ImageUploadField
            label={t("forms.eventImage") || "Event Image"}
            imagePreview={imagePreview}
            onImageUpload={onImageUpload}
            onRemoveImage={onRemoveImage}
          />
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  );
}
