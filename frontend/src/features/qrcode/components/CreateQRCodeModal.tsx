import React from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Download } from "lucide-react";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { QRCodePreview } from "@/shared/ui/qrcode-preview";
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
import type { QRCode, Event } from "@/shared/types";
import { useSuccessAlert } from "@/shared/hooks/useSuccessAlert";
import { useModalState } from "@/shared/hooks/useModalState";
import { useCreateQRCodeForm } from "@/features/qrcode/hooks/useCreateQRCodeForm";
import { generateQRCodeUrl, downloadQRCodeAsPNG } from "@/shared/utils/qrGenerator";
import { createPosterToBackend } from "@/features/qrcode/api/qrcode.api";
import {
  CreateQRCodeModalProvider,
  useCreateQRCodeModalContext,
} from "@/features/qrcode/contexts/CreateQRCodeModal.context";

interface CreateQRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (qrCode: QRCode) => void;
  events: Event[];
  userEmail: string;
}

function CreateQRCodeModalContent() {
  const { t } = useTranslation();
  const { isOpen, onClose, onCreate, events, userEmail } = useCreateQRCodeModalContext();
  const form = useCreateQRCodeForm(events, userEmail);
  const { show: showSuccessAlert, SuccessAlertComponent } = useSuccessAlert({ onClose });

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
        form.state.destinationType === "event"
          ? form.state.selectedEventId
          : form.state.destinationType === "custom-url"
            ? form.state.customUrl.trim()
            : null;
      const qrCode = await createPosterToBackend({
        id,
        name: form.state.name.trim(),
        description: form.state.description.trim() || null,
        destination_type: form.state.destinationType,
        destination_id: destId ?? undefined,
        filters: form.state.destinationType === "events-list" ? form.state.filters : undefined,
        created_by: userEmail,
        is_active: true,
        image_url: form.state.imageUrl || null,
      });
      form.dispatch({ type: "SET_QR_CODE_ID", payload: qrCode.id });
      onCreate(qrCode);
      showSuccessAlert(
        t("qrCode.posterCreated"),
        t("qrCode.posterCreatedMessage", { name: qrCode.name })
      );
    } catch (err) {
      console.error("Failed to create QR code:", err);
      setCreateError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!form.state.qrCodeId) return;
    const qrUrl = generateQRCodeUrl(form.state.qrCodeId);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = 512;
      canvas.height = 512;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      downloadQRCodeAsPNG(dataUrl, form.state.name.trim() || t("qrCode.defaultFileName"));
    };
  };

  const qrUrl = form.state.qrCodeId ? generateQRCodeUrl(form.state.qrCodeId) : "";

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
          {!form.state.qrCodeId ? (
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
                        value={form.state.name}
                        onChange={(e) => form.dispatch({ type: "SET_NAME", payload: e.target.value })}
                        placeholder={t("forms.posterNamePlaceholder")}
                        className={form.state.errors.name ? "border-error" : ""}
                      />
                      {form.state.errors.name && (
                        <FieldError className="text-xs">{form.state.errors.name}</FieldError>
                      )}
                    </Field>

                    <ImageUploadField
                      label={t("qrCode.posterImage")}
                      required
                      imagePreview={form.state.imagePreview}
                      error={form.state.errors.image}
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
                        value={form.state.destinationType}
                        onChange={(value) =>
                          form.dispatch({
                            type: "SET_DESTINATION_TYPE",
                            payload: value as "event" | "events-list" | "custom-url",
                          })
                        }
                        name="destinationType"
                      />
                    </Field>

                    {form.state.destinationType === "custom-url" && (
                      <Field>
                        <FieldLabel htmlFor="custom-url" className="text-sm font-medium text-foreground">
                          {t("qrCode.url")} <span className="text-error">*</span>
                        </FieldLabel>
                        <Input
                          id="custom-url"
                          type="url"
                          value={form.state.customUrl}
                          onChange={(e) => form.dispatch({ type: "SET_CUSTOM_URL", payload: e.target.value })}
                          placeholder={t("forms.urlPlaceholder")}
                          className={form.state.errors.url ? "border-error" : ""}
                        />
                        {form.state.errors.url && (
                          <FieldError className="text-xs">{form.state.errors.url}</FieldError>
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
                        value={form.state.description}
                        onChange={(e) => form.dispatch({ type: "SET_DESCRIPTION", payload: e.target.value })}
                        placeholder={t("forms.descriptionPlaceholder")}
                      />
                    </Field>

                    {form.state.destinationType === "event" && (
                      <Field>
                        <FieldLabel className="text-sm font-medium text-foreground">
                          {t("qrCode.selectEvent")}
                        </FieldLabel>
                        <Select
                          value={form.state.selectedEventId?.toString() || undefined}
                          onValueChange={(value) =>
                            form.dispatch({ type: "SET_SELECTED_EVENT_ID", payload: parseInt(value) })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("forms.chooseEvent")} />
                          </SelectTrigger>
                          <SelectContent>
                            {form.uniqueEvents.map((event) => (
                              <SelectItem key={event.id} value={event.id.toString()}>
                                {event.title} - {event.date}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}

                    {form.state.destinationType === "events-list" && (
                      <Field>
                        <FieldLabel className="text-sm font-medium text-foreground">
                          {t("qrCode.filterEvents")}
                        </FieldLabel>
                        <FieldDescription>
                          {t("qrCode.filterEventsDesc")}
                        </FieldDescription>
                        <div className="p-4 border border-border rounded-xl bg-muted/50">
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
                    onClick={handleGenerate}
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
              name={form.state.name}
              onDone={onClose}
              doneLabel={t("qrCode.done")}
              successMessage={t("qrCode.qrCodeGeneratedSuccessfully")}
            />
          )}
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
    <SuccessAlertComponent />
    </>
  );
}

export function CreateQRCodeModal(props: CreateQRCodeModalProps) {
  return (
    <CreateQRCodeModalProvider value={props}>
      <CreateQRCodeModalContent />
    </CreateQRCodeModalProvider>
  );
}
