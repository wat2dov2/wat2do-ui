import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  submitContactMessage,
  type ContactMessage,
} from "@/features/contact/api/contact.api";
import { controlBox } from "@/shared/config/controlBox";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";

const EMPTY_MESSAGE: ContactMessage = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

export function ContactForm() {
  const { t } = useTranslation();
  const [form, setForm] = useState<ContactMessage>(EMPTY_MESSAGE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const setField = (field: keyof ContactMessage, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await submitContactMessage({
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      setForm(EMPTY_MESSAGE);
      setIsSubmitted(true);
    } catch (error) {
      toast({
        description: getApiErrorMessage(error, t("contact.form.error")),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("contact.form.title")}</CardTitle>
        <CardDescription>{t("contact.form.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isSubmitted ? (
          <div className="space-y-4">
            <p className="text-sm text-success">
              {t("contact.form.success")}
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsSubmitted(false)}
            >
              {t("contact.form.sendAnother")}
            </Button>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="contact-name">
                  {t("contact.form.name")}
                </FieldLabel>
                <Input
                  id="contact-name"
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                  maxLength={controlBox.contact.maximumNameLength}
                  autoComplete="name"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-email">
                  {t("contact.form.email")}
                </FieldLabel>
                <Input
                  id="contact-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setField("email", event.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-subject">
                  {t("contact.form.subject")}
                </FieldLabel>
                <Input
                  id="contact-subject"
                  value={form.subject}
                  onChange={(event) => setField("subject", event.target.value)}
                  maxLength={controlBox.contact.maximumSubjectLength}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-message">
                  {t("contact.form.message")}
                </FieldLabel>
                <Textarea
                  id="contact-message"
                  value={form.message}
                  onChange={(event) => setField("message", event.target.value)}
                  maxLength={controlBox.contact.maximumMessageLength}
                  className="min-h-36"
                  required
                />
              </Field>
              <LoadingButton
                type="submit"
                isLoading={isSubmitting}
                loadingText={t("contact.form.sending")}
                className="w-full sm:w-fit"
              >
                {t("contact.form.submit")}
              </LoadingButton>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
