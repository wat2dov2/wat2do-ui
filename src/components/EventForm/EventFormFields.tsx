import React from "react";
import { useTranslation } from "react-i18next";
import { MapPin, DollarSign, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { availableCategories, availableLocations } from "@/data/events";
import { FormInput, FormSelect, FormDatePicker, FormTextarea } from "@/components/ui/form-field";
import { TagInput } from "@/components/ui/tag-input";
import { useEventFormContext } from "./EventFormContext";

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
              label={t("events.date")}
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
              inputClassName="h-9 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </FieldGroup>

          <FormSelect
            name="location"
            label={t("forms.location")}
            required
            value={formData.location}
            onChange={(value) => updateField("location", value)}
            onBlur={() => handleBlur("location")}
            placeholder={t("forms.selectLocation")}
            options={availableLocations.map((loc) => ({ value: loc, label: loc }))}
            labelIcon={<MapPin className="w-4 h-4" />}
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
              label={t("forms.category")}
              value={formData.category}
              onChange={(value) => updateField("category", value)}
              placeholder={t("forms.selectCategory")}
              options={availableCategories.map((cat) => ({ value: cat, label: cat }))}
            />

            <FormInput
              name="price"
              label={t("forms.price")}
              type="number"
              value={formData.price}
              onChange={(value) => updateField("price", value as number)}
              placeholder={t("forms.pricePlaceholder")}
              step="0.01"
              min="0"
              prefix="$"
              labelIcon={<DollarSign className="w-4 h-4" />}
            />
          </FieldGroup>

          <TagInput
            label={t("forms.foodProvided")}
            labelIcon={<Utensils className="w-4 h-4" />}
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
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  );
}
