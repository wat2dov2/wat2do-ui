import { useCallback, useState, type ChangeEvent } from "react";

/**
 * An image picked in a form, held locally until the form saves it, with a
 * preview of either that file or the image the form already has.
 */
export function useImageFile(initialPreview = "") {
  const [imagePreview, setImagePreview] = useState(initialPreview);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const onImageUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (loaded) => setImagePreview((loaded.target?.result as string) || "");
    reader.readAsDataURL(file);
  }, []);

  /** Shows a saved image and drops any picked file. */
  const resetImage = useCallback((preview: string) => {
    setImagePreview(preview);
    setImageFile(null);
  }, []);

  const onRemoveImage = useCallback(() => resetImage(""), [resetImage]);

  return { imagePreview, imageFile, onImageUpload, onRemoveImage, resetImage };
}
