import { useReducer, useRef, useCallback } from "react";
import type { QRCode } from "@/shared/types";
import {
  qrCodeImageReducer,
  type QRCodeImageState,
} from "@/features/qrcode/hooks/useQRCodeImage.reducer";
import { MAX_UPLOAD_SIZE_BYTES } from "@/features/qrcode/constants";

interface UseQRCodeImageOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

export function useQRCodeImage({ qrCode, isOpen }: UseQRCodeImageOptions) {
  const imageUrl = qrCode.imageUrl || "";
  
  const initialState: QRCodeImageState = {
    editedImageUrl: imageUrl,
    imagePreview: imageUrl,
  };

  const [state, dispatch] = useReducer(qrCodeImageReducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      dispatch({ type: "SET_IMAGE_PREVIEW", payload: dataUrl });
    };
    reader.readAsDataURL(file);

    import("@/shared/services/uploadService").then(({ uploadQRAsset }) => {
      uploadQRAsset(file).then((url) => {
        dispatch({ type: "SET_EDITED_IMAGE_URL", payload: url });
        dispatch({ type: "SET_IMAGE_PREVIEW", payload: url });
      }).catch((err) => {
        console.error("Failed to upload QR asset:", err);
        const reader2 = new FileReader();
        reader2.onload = (ev) => {
          const fallback = ev.target?.result as string;
          dispatch({ type: "SET_EDITED_IMAGE_URL", payload: fallback });
        };
        reader2.readAsDataURL(file);
      });
    });
  }, []);

  const handleRemoveImage = useCallback(() => {
    dispatch({ type: "REMOVE_IMAGE" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return {
    editedImageUrl: state.editedImageUrl,
    setEditedImageUrl: (url: string) =>
      dispatch({ type: "SET_EDITED_IMAGE_URL", payload: url }),
    imagePreview: state.imagePreview,
    fileInputRef,
    handleImageUpload,
    handleRemoveImage,
  };
}
