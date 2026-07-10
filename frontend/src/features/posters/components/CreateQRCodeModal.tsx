import React from "react";
import { useTranslation } from "react-i18next";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { QRCodePreview } from "@/features/posters/components/QRCodePreview";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
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
import { ModalContentWrapper, ModalHeaderWrapper } from "@/shared/ui/modal-components";
import type { Event } from "@/shared/types";
import type { QRCode } from "@/features/posters/types";
import { toast } from "@/shared/hooks/use-toast";
import { useModalState } from "@/shared/hooks/useModalState";
import { useCreateQRCodeForm } from "@/features/posters/hooks/useCreateQRCodeForm";
import { useCreatePoster } from "@/features/posters/hooks/useCreatePoster";
import { uploadQRAsset } from "@/shared/services/uploadService";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { formatCardDate } from "@/shared/utils/date";

interface CreateQRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (qrCode: QRCode) => void;
  events: Event[];
  userEmail: string;
}

function CreateQRCodeModalContent({
  isOpen,
  onClose,
  onCreate,
  events,
}: CreateQRCodeModalProps) {
  const { t, i18n } = useTranslation();
  const form = useCreateQRCodeForm(events);
  const { createPoster } = useCreatePoster();

  // Use modal state hook for standardized open/close handling
  const modalState = useModalState({
    onClose,
    resetOnClose: true,
    resetFn: form.reset,
  });

  const [isGenerating, setIsGenerating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const handleGenerate = async () => {
    if (!form.validate()) return;
    setCreateError(null);
    setIsGenerating(true);
    try {
      const id = crypto.randomUUID();
      const destId =
        form.formData.destinationType === "event"
          ? form.formData.selectedEventId
          : form.formData.destinationType === "custom-url"
            ? form.formData.customUrl.trim()
            : null;
      const imageUrl = form.formData.imageFile
        ? await uploadQRAsset(form.formData.imageFile)
        : null;
      const qrCode = await createPoster({
        id,
        name: form.formData.name.trim(),
        description: form.formData.description.trim() || null,
        destination_type: form.formData.destinationType,
        destination_id: destId ?? undefined,
        // ``filters`` is typed strictly on the FE (FilterState) but the
        // backend persists opaque JSON - cast through unknown so the
        // payload type matches QrCodePosterBackend.filters:
        // ``Record<string, unknown> | unknown[] | null``.
        filters: form.formData.destinationType === "events-list"
          ? (form.formData.filters as unknown as Record<string, unknown>)
          : undefined,
        image_url: imageUrl,
      });
      form.setQrCodeId(qrCode.id);
      onCreate(qrCode);
      toast({
        title: t("qrCode.posterCreated"),
        description: t("qrCode.posterCreatedMessage", { name: qrCode.name }),
        variant: "success",
      });
    } catch (err) {
      console.error("Failed to create QR code:", err);
      setCreateError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsGenerating(false);
    }
  };

  const qrUrl = form.qrCodeId ? generateQRCodeUrl(form.qrCodeId) : "";

  const destinationOptions = [
    {
      value: "event",
      label: t("qrCode.specificEvent"),
      description: t("qrCode.specificEventDesc"),
    },
    {
      value: "events-list",
      label: t("qrCode.eventsList"),
      description: `${t("qrCode.eventsListDesc")} (${form.uniqueEvents.length} ${form.uniqueEvents.length === 1 ? t("common.event") : t("common.events")})`,
    },
    {
      value: "custom-url",
      label: t("qrCode.customUrl"),
      description: t("qrCode.customUrlDesc"),
    },
  ];

  return (
    <>
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="p-0 max-w-2xl max-h-[90vh] overflow-y-auto">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t("qrCode.createQRCode")}</DialogTitle>
            <DialogDescription>
              {t("qrCode.createQRCodeDescription")}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          {!form.qrCodeId ? (
            <>
            <form>
              <FieldGroup>
                <FieldSet>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="poster-name" className="text-sm font-medium text-foreground">
                        {t("qrCode.posterName")} <span className="text-error">*</span>
                      </FieldLabel>
                      <Input
                        id="poster-name"
                        value={form.formData.name}
                        onChange={(e) => form.updateField("name", e.target.value)}
                        placeholder={t("forms.posterNamePlaceholder")}
                        className={form.errors.name ? "border-error" : ""}
                      />
                      {form.errors.name && (
                        <FieldError className="text-xs">{form.errors.name}</FieldError>
                      )}
                    </Field>

                    <ImageUploadField
                      label={t("qrCode.posterImage")}
                      required
                      imagePreview={form.formData.imagePreview}
                      error={form.errors.image}
                      onImageUpload={form.handleImageUpload}
                      onRemoveImage={form.handleRemoveImage}
                      fileInputRef={form.fileInputRef}
                    />

                    <Field>
                      <FieldLabel className="text-sm font-medium text-foreground">
                        {t("qrCode.destination")} <span className="text-error">*</span>
                      </FieldLabel>
                      <RadioOptionGroup
                        options={destinationOptions}
                        value={form.formData.destinationType}
                        onChange={(value) =>
                          form.updateField(
                            "destinationType",
                            value as "event" | "events-list" | "custom-url",
                          )
                        }
                        name="destinationType"
                      />
                    </Field>

                    {form.formData.destinationType === "custom-url" && (
                      <Field>
                        <FieldLabel htmlFor="custom-url" className="text-sm font-medium text-foreground">
                          {t("qrCode.url")} <span className="text-error">*</span>
                        </FieldLabel>
                        <Input
                          id="custom-url"
                          type="url"
                          value={form.formData.customUrl}
                          onChange={(e) => form.updateField("customUrl", e.target.value)}
                          placeholder={t("forms.urlPlaceholder")}
                          className={form.errors.url ? "border-error" : ""}
                        />
                        {form.errors.url && (
                          <FieldError className="text-xs">{form.errors.url}</FieldError>
                        )}
                      </Field>
                    )}
                  </FieldGroup>
                </FieldSet>

                <FieldSeparator />

                <FieldSet>
                  <FieldLegend>{t("forms.optionalDetails")}</FieldLegend>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="poster-description" className="text-sm font-medium text-foreground">
                        {t("forms.description")}
                      </FieldLabel>
                      <Input
                        id="poster-description"
                        value={form.formData.description}
                        onChange={(e) => form.updateField("description", e.target.value)}
                        placeholder={t("forms.descriptionPlaceholder")}
                      />
                    </Field>

                    {form.formData.destinationType === "event" && (
                      <Field>
                        <FieldLabel className="text-sm font-medium text-foreground">
                          {t("qrCode.selectEvent")}
                        </FieldLabel>
                        <Select
                          value={form.formData.selectedEventId?.toString() || undefined}
                          onValueChange={(value) =>
                            form.updateField("selectedEventId", parseInt(value))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("forms.chooseEvent")} />
                          </SelectTrigger>
                          <SelectContent>
                            {form.uniqueEvents.map((event) => (
                              <SelectItem key={event.id} value={event.id.toString()}>
                                {event.title} - {formatCardDate(event, i18n.language || "en-US")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}

                    {form.formData.destinationType === "events-list" && (
                      <Field>
                        <FieldLabel className="text-sm font-medium text-foreground">
                          {t("qrCode.filterEvents")}
                        </FieldLabel>
                        <FieldDescription>
                          {t("qrCode.filterEventsDesc")}
                        </FieldDescription>
                        <div className="p-4 border border-border rounded-xl bg-secondary/50">
                          <p className="text-xs text-muted-foreground">
                            {t("qrCode.advancedFilteringMessage")}
                          </p>
                        </div>
                      </Field>
                    )}
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
                    onMouseDown={handleGenerate}
                    isLoading={isGenerating}
                    loadingText={t("common.pleaseWait") || "Please wait..."}
                  >
                    {t("qrCode.generateQRCode")}
                  </LoadingButton>
                </Field>
                {createError && (
                  <FieldError className="text-xs text-error">{createError}</FieldError>
                )}
              </FieldGroup>
            </form>

            </>
          ) : (
            <QRCodePreview
              qrUrl={qrUrl}
              name={form.formData.name}
              onDone={onClose}
              doneLabel={t("qrCode.done")}
              successMessage={t("qrCode.qrCodeGeneratedSuccessfully")}
            />
          )}
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
    </>
  );
}

export function CreateQRCodeModal(props: CreateQRCodeModalProps) {
  return <CreateQRCodeModalContent {...props} />;
}
