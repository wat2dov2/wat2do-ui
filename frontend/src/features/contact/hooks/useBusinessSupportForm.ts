import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  BUSINESS_SUPPORT_FIELD_LIMITS,
  buildBusinessSupportMessage,
  submitContactMessage,
  type BusinessSupportNomination,
} from "@/features/contact/api/contact.api";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { getApiErrorMessage } from "@/shared/services/apiClient";

type FieldName = keyof BusinessSupportNomination;
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY_NOMINATION: BusinessSupportNomination = {
  businessName: "",
  location: "",
  website: "",
  reasonForSupport: "",
  proposedBannerText: "",
  studentTrafficPerWeek: "",
  email: "",
};

function isWebsite(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function useBusinessSupportForm(school: SchoolSummary | undefined) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_NOMINATION);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted">("idle");
  const submitting = useRef(false);

  const setField = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;

    const nextErrors: FieldErrors = {};
    for (const field of Object.keys(BUSINESS_SUPPORT_FIELD_LIMITS) as FieldName[]) {
      const value = form[field].trim();
      if (field !== "website" && !value) {
        nextErrors[field] = t("contact.businessSupport.validation.required");
      } else if (value.length > BUSINESS_SUPPORT_FIELD_LIMITS[field]) {
        nextErrors[field] = t("contact.businessSupport.validation.tooLong", {
          maximum: BUSINESS_SUPPORT_FIELD_LIMITS[field],
        });
      }
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = t("contact.businessSupport.validation.email");
    }
    if (form.website.trim() && !isWebsite(form.website.trim())) {
      nextErrors.website = t("contact.businessSupport.validation.website");
    }
    setErrors(nextErrors);
    setSubmissionError(null);
    const firstInvalidField = Object.keys(nextErrors)[0];
    if (firstInvalidField) {
      const input = event.currentTarget.elements.namedItem(firstInvalidField);
      if (input instanceof HTMLElement) input.focus();
      return;
    }

    submitting.current = true;
    setStatus("submitting");
    try {
      await submitContactMessage(buildBusinessSupportMessage(form, school));
      setForm(EMPTY_NOMINATION);
      setStatus("submitted");
    } catch (error) {
      setSubmissionError(
        error instanceof RangeError
          ? t("contact.businessSupport.validation.messageTooLong")
          : getApiErrorMessage(error, t("contact.businessSupport.error")),
      );
      setStatus("idle");
    } finally {
      submitting.current = false;
    }
  };

  const reset = () => {
    setForm(EMPTY_NOMINATION);
    setErrors({});
    setSubmissionError(null);
    setStatus("idle");
  };

  return { form, errors, submissionError, status, setField, handleSubmit, reset };
}
