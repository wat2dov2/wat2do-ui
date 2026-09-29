import { useTranslation } from "react-i18next";

import {
  BUSINESS_SUPPORT_FIELD_LIMITS,
  type BusinessSupportNomination,
} from "@/features/contact/api/contact.api";
import { useBusinessSupportForm } from "@/features/contact/hooks/useBusinessSupportForm";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { FormActions, FormLayout, Stack } from "@/shared/layout";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CheckCircle } from "@/shared/ui/doodle-icons";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";

type BusinessSupportField = {
  name: keyof BusinessSupportNomination;
  type?: "text" | "url" | "email";
  multiline?: boolean;
  hint?: boolean;
  autoComplete?: string;
};

const FIELDS: readonly BusinessSupportField[] = [
  { name: "businessName", type: "text", autoComplete: "organization" },
  { name: "location", type: "text", autoComplete: "street-address" },
  { name: "website", type: "url", hint: true, autoComplete: "url" },
  { name: "reasonForSupport", multiline: true },
  { name: "proposedBannerText", multiline: true, hint: true },
  { name: "studentTrafficPerWeek", type: "text", hint: true },
  { name: "email", type: "email", hint: true, autoComplete: "email" },
];

export function BusinessSupportForm({ school }: { school: SchoolSummary | undefined }) {
  const { t } = useTranslation();
  const form = useBusinessSupportForm(school);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("contact.businessSupport.formTitle")}</CardTitle>
        <CardDescription>{t("contact.businessSupport.formDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {form.status === "submitted" ? (
          <Stack gap={4}>
            <Alert variant="success" role="status">
              <CheckCircle />
              <AlertTitle>{t("contact.businessSupport.successTitle")}</AlertTitle>
              <AlertDescription>{t("contact.businessSupport.success")}</AlertDescription>
            </Alert>
            <FormActions align="start">
              <Button type="button" variant="outline" onClick={form.reset}>
                {t("contact.businessSupport.sendAnother")}
              </Button>
            </FormActions>
          </Stack>
        ) : (
          <FormLayout noValidate onSubmit={(event) => void form.handleSubmit(event)}>
            <FieldSet disabled={form.status === "submitting"}>
              <FieldGroup>
                {FIELDS.map((field) => {
                  const id = `business-support-${field.name}`;
                  const error = form.errors[field.name];
                  const description = [
                    field.hint ? `${id}-hint` : null,
                    error ? `${id}-error` : null,
                  ].filter(Boolean).join(" ") || undefined;
                  const props = {
                    id,
                    name: field.name,
                    value: form.form[field.name],
                    maxLength: BUSINESS_SUPPORT_FIELD_LIMITS[field.name],
                    required: field.name !== "website",
                    "aria-invalid": Boolean(error),
                    "aria-describedby": description,
                  };

                  return (
                    <Field key={field.name} data-invalid={Boolean(error)}>
                      <FieldLabel htmlFor={id}>
                        {t(`contact.businessSupport.fields.${field.name}.label`)}
                      </FieldLabel>
                      {field.multiline ? (
                        <Textarea
                          {...props}
                          rows={field.name === "reasonForSupport" ? 5 : 3}
                          onChange={(event) => form.setField(field.name, event.target.value)}
                        />
                      ) : (
                        <Input
                          {...props}
                          type={field.type}
                          autoComplete={field.autoComplete}
                          onChange={(event) => form.setField(field.name, event.target.value)}
                        />
                      )}
                      {field.hint ? (
                        <FieldDescription id={`${id}-hint`}>
                          {t(`contact.businessSupport.fields.${field.name}.hint`)}
                        </FieldDescription>
                      ) : null}
                      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
                    </Field>
                  );
                })}
              </FieldGroup>
            </FieldSet>
            {form.submissionError ? (
              <Alert variant="destructive">
                <AlertDescription>{form.submissionError}</AlertDescription>
              </Alert>
            ) : null}
            <FormActions align="start">
              <LoadingButton
                type="submit"
                isLoading={form.status === "submitting"}
                loadingText={t("contact.businessSupport.sending")}
              >
                {t("contact.businessSupport.submit")}
              </LoadingButton>
            </FormActions>
          </FormLayout>
        )}
      </CardContent>
    </Card>
  );
}
