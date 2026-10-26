import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { Section, Stack } from "@/shared/layout";
import type { ImageParse } from "@/shared/hooks/useImageParse";

interface ImageParseStepProps {
  title: string;
  description: string;
  processingLabel: string;
  imageParse: ImageParse;
  /** Offered where an image is optional, so the form can be filled by hand. */
  onSkip?: () => void;
}

/** First step of a submission: upload or paste an image to prefill the form. */
export function ImageParseStep({
  title,
  description,
  processingLabel,
  imageParse,
  onSkip,
}: ImageParseStepProps) {
  const { t } = useTranslation();

  return (
    <Section variant="surface" className="mx-auto w-full max-w-2xl">
      <Stack align="center" gap={4}>
        <Stack align="center" gap={1} className="text-center">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </Stack>

        {imageParse.isParsing ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 py-8">
            <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium text-foreground">{processingLabel}</p>
          </div>
        ) : (
          <div className="w-full">
            <ImageUploadField
              fileInputRef={imageParse.fileInputRef}
              label={t("forms.clickToUploadOrPasteImage")}
              accept={imageParse.accept}
              onImageUpload={imageParse.onImageUpload}
            />
          </div>
        )}

        {onSkip && !imageParse.isParsing ? (
          <Button type="button" variant="ghost" onClick={onSkip}>
            {t("forms.skipImageUpload")}
          </Button>
        ) : null}
      </Stack>
    </Section>
  );
}
