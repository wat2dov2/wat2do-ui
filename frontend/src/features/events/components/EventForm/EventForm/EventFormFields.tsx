import React from "react";
import { useTranslation } from "react-i18next";
import { MapPin, DollarSign, Utensils } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/shared/ui/field";
import { Switch } from "@/shared/ui/switch";
import { availableCategories } from "@/features/events/data/events";
import { translateCategory } from "@/shared/utils/event";
import { FormInput, FormSelect, FormDatePicker, FormTextarea } from "@/shared/ui/form-field";
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
    selectedDate,
    handleDateChange,
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
        <FieldDescription>
          {t("forms.requiredFieldsNote")}
        </FieldDescription>
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

          <FieldGroup className="grid grid-cols-2">
            <FormDatePicker
              name="date"
              label={t("filters.date")}
              required
              value={selectedDate}
              onChange={handleDateChange}
              onBlur={() => handleBlur("date")}
              placeholder={t("forms.pickDate")}
              error={errors.date}
              touched={touched.date}
            />

            <FormInput
              name="time"
              label={t("forms.time")}
              type="time"
              required
              value={formData.time}
              onChange={(value) => updateField("time", value as string)}
              onBlur={() => handleBlur("time")}
              error={errors.time}
              touched={touched.time}
              inputClassName="text-secondary-foreground appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </FieldGroup>

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
              options={availableCategories.map((cat) => ({ value: cat, label: translateCategory(cat, t) }))}
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
