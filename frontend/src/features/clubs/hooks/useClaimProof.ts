import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { controlBox } from "@/shared/config/controlBox";

// The picker and the server read the same control-box contract, so a file the
// browser lets through is one the server will accept.
const PROOF_ALLOWED_MIME_TYPES: readonly string[] = controlBox.uploads.claimProofAllowedMimeTypes;
const PROOF_ACCEPT = PROOF_ALLOWED_MIME_TYPES.join(",");
const PROOF_MAX_SIZE_BYTES = controlBox.uploads.claimProofMaxSizeBytes;
const BYTES_PER_MEGABYTE = 1024 * 1024;

interface ClaimProofPreview {
  url: string;
  media: "image" | "video";
}

/**
 * A claim's proof: a screenshot or a screen recording (an executive logged in
 * to the club's Instagram, say), checked and previewed before it is sent.
 */
export function useClaimProof() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ClaimProofPreview>();
  const [error, setError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A preview is the chosen file's object URL, released once it is replaced or the form goes away.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const clear = useCallback(() => {
    setFile(null);
    setPreview(undefined);
    setError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const select = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0];
      if (!chosen) return;
      const rejection = !PROOF_ALLOWED_MIME_TYPES.includes(chosen.type)
        ? t("clubs.proofTypeError")
        : chosen.size > PROOF_MAX_SIZE_BYTES
          ? t("clubs.proofSizeError", { size: PROOF_MAX_SIZE_BYTES / BYTES_PER_MEGABYTE })
          : null;
      if (rejection) {
        event.target.value = "";
        setError(rejection);
        return;
      }
      setFile(chosen);
      setPreview({
        url: URL.createObjectURL(chosen),
        media: chosen.type.startsWith("video/") ? "video" : "image",
      });
      setError(undefined);
    },
    [t],
  );

  return {
    file,
    preview,
    error,
    fileInputRef,
    accept: PROOF_ACCEPT,
    select,
    clear,
  };
}
