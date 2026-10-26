import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { controlBox } from "@/shared/config/controlBox";
import { toast } from "@/shared/hooks/use-toast";

// The picker, the paste handler, and the server all read the same control-box
// contract, so a file the browser lets through is one the server will accept.
const IMAGE_ALLOWED_MIME_TYPES = controlBox.uploads.eventImageAllowedMimeTypes;
const IMAGE_MAX_SIZE_BYTES = controlBox.uploads.eventImageMaxSizeBytes;
const IMAGE_ACCEPT = IMAGE_ALLOWED_MIME_TYPES.join(",");

const isAllowedImageType = (type: string): boolean =>
  (IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(type);

interface ImageParseCopy {
  /** Toast title for a rejected file or a failed extraction. */
  failedTitle: string;
  /** Toast description when extraction fails without a server message. */
  failedDescription: string;
  /** Toast description after the details were extracted. */
  extracted: string;
}

interface UseImageParseOptions {
  /** Inactive forms retain drafts without handling clipboard input. */
  active: boolean;
  copy: ImageParseCopy;
  /** Reads the image and fills the form; throws when nothing could be read. */
  parse: (file: File) => Promise<void>;
  /** Runs after every extraction attempt, so the form opens either way. */
  onSettled: () => void;
}

/**
 * Reads details out of an uploaded or pasted image (a flyer or a poster):
 * validates the file, runs the caller's parser, and reports the outcome.
 */
export function useImageParse({ active, copy, parse, onSettled }: UseImageParseOptions) {
  const { t } = useTranslation();
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(
    async (file: File) => {
      const rejection = !isAllowedImageType(file.type)
        ? t("forms.imageTypeError")
        : file.size > IMAGE_MAX_SIZE_BYTES
          ? t("qrCode.imageSizeError")
          : null;
      if (rejection) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        toast({ title: copy.failedTitle, description: rejection, variant: "destructive" });
        return;
      }

      setIsParsing(true);
      try {
        await parse(file);
        toast({ title: t("common.success"), description: copy.extracted });
      } catch (error) {
        console.error("AI image parse error:", error);
        toast({
          title: copy.failedTitle,
          description: error instanceof Error ? error.message : copy.failedDescription,
          variant: "destructive",
        });
      } finally {
        setIsParsing(false);
        onSettled();
      }
    },
    [copy, parse, onSettled, t],
  );

  const onImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await parseFile(file);
    },
    [parseFile],
  );

  useEffect(() => {
    if (!active || isParsing) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (!isAllowedImageType(item.type)) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        await parseFile(file);
        break;
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [active, isParsing, parseFile]);

  return { isParsing, fileInputRef, accept: IMAGE_ACCEPT, onImageUpload };
}

export type ImageParse = ReturnType<typeof useImageParse>;
