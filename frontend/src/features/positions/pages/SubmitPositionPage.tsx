"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { usePositionSubmission } from "@/features/positions/hooks/usePositionSubmission";
import { Container, FormActions, FormGrid, PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { FormInput, FormSelect, FormTextarea } from "@/shared/ui/form-field";
import { Field, FieldError, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { SearchCombobox } from "@/shared/ui/search-combobox";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { ROUTES } from "@/shared/constants/routes";
import { QP } from "@/shared/constants/queryParams";
import type { PositionType } from "@/shared/types";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";

export function SubmitPositionPage() {
  const { t } = useTranslation();
  const form = usePositionSubmission();
  const data = form.data;
  const clubs = form.clubs.data ?? [];
  return (
    <Container size="lg">
      <Stack gap={6}>
        <PageHeader title={t("positions.addPosition")} back={{ href: ROUTES.POSITIONS, label: t("navigation.positions") }} />
        {!form.isAuthenticated ? <Button asChild><Link href={ROUTES.LOGIN + "?" + QP.RETURN_TO + "=" + encodeURIComponent(ROUTES.POSITION_SUBMIT)}>{t("events.signIn")}</Link></Button> : form.submitted ? (
          <Stack gap={3}><p role="status">{t("positions.submitted")}</p><Button asChild><Link href={ROUTES.POSITIONS}>{t("navigation.positions")}</Link></Button></Stack>
        ) : (
          <form onSubmit={form.submit}>
            <fieldset disabled={form.busy}>
              <Stack gap={5}>
                <ImageUploadField label={t("forms.clickToUploadImage")} imagePreview={data.source_image_url ?? undefined} onImageUpload={form.upload} onRemoveImage={() => form.edit({ source_image_url: null })} previewVariant="poster" />
                <Field>
                  <FieldLabel htmlFor="position-club">{t("navigation.clubs")}</FieldLabel>
                  <SearchCombobox id="position-club" selectedKey={data.club_id} items={clubs} getKey={club => club.id} getLabel={club => club.club_name} displayValue={clubs.find(club => club.id === data.club_id)?.club_name ?? t("forms.selectClub")} onSelect={club => form.edit({ club_id: club.id })} searchPlaceholder={t("clubs.searchPlaceholder")} emptyLabel={t("clubs.noClubsFound")} />
                  {form.clubs.isError ? <Button type="button" variant="outline" onClick={() => void form.clubs.refetch()}>{t("common.tryAgain")}</Button> : null}
                </Field>
                <FormInput name="position-title" placeholder={t("positions.placeholders.title")} label={t("positions.title")} required value={data.title} onChange={title => form.edit({ title: String(title) })} />
                <FormTextarea name="position-description" placeholder={t("positions.placeholders.description")} label={t("forms.description")} required value={data.description} onChange={description => form.edit({ description })} rows={5} />
                <FormGrid columns={2}>
                  <FormSelect name="position-type" label={t("positions.filterByType")} value={data.position_type} onChange={value => form.edit({ position_type: value as PositionType })} options={POSITION_TYPES.map(value => ({ value, label: t(`positions.types.${value}`) }))} />
                  <FormSelect name="position-paid" label={t("positions.compensationLabel")} value={data.is_paid === null ? "unknown" : data.is_paid ? "paid" : "unpaid"} onChange={value => form.edit({ is_paid: value === "unknown" ? null : value === "paid" })} options={["unknown", "paid", "unpaid"].map(value => ({ value, label: t(`positions.${value}`) }))} />
                  <FormInput name="position-compensation" placeholder={t("positions.placeholders.compensation")} label={t("positions.compensationLabel")} value={data.compensation ?? ""} onChange={value => form.edit({ compensation: String(value) || null })} />
                  <FormInput name="position-commitment" placeholder={t("positions.placeholders.commitment")} label={t("positions.commitmentLabel")} value={data.commitment ?? ""} onChange={value => form.edit({ commitment: String(value) || null })} />
                  <FormInput name="position-location" placeholder={t("forms.locationPlaceholder")} label={t("positions.locationLabel")} value={data.location ?? ""} onChange={value => form.edit({ location: String(value) || null })} />
                  <FormInput name="position-contact" placeholder={t("positions.placeholders.contact")} type="email" label={t("positions.contactLabel")} value={data.contact_email ?? ""} onChange={value => form.edit({ contact_email: String(value) || null })} />
                  <Field><FieldLabel htmlFor="position-deadline">{t("positions.deadlineLabel")}</FieldLabel><Input id="position-deadline" type="date" value={data.deadline_date ?? ""} onChange={event => form.edit({ deadline_date: event.target.value || null, deadline_at: null })} /></Field>
                  <FormInput name="position-source" placeholder={t("forms.sourceUrlPlaceholder")} type="url" label={t("forms.sourceUrl")} required value={data.source_url} onChange={value => form.edit({ source_url: String(value) })} />
                </FormGrid>
                <FormTextarea name="position-requirements" placeholder={t("positions.placeholders.requirements")} label={t("positions.requirements")} value={(data.requirements ?? []).join("\n")} onChange={value => form.edit({ requirements: value.split("\n") })} />
                {form.error ? <FieldError role="alert">{form.error}</FieldError> : null}
                <FormActions><LoadingButton type="submit" isLoading={form.busy} disabled={!clubs.some(club => club.id === data.club_id)}>{t("events.submitForReview")}</LoadingButton></FormActions>
              </Stack>
            </fieldset>
          </form>
        )}
      </Stack>
    </Container>
  );
}
