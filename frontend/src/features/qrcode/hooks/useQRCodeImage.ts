import { useReducer, useRef, useCallback } from "react";
import type { QRCode } from "@/shared/types";
import {
  qrCodeImageReducer,
  type QRCodeImageState,
} from "@/features/qrcode/hooks/useQRCodeImage.reducer";

interface UseQRCodeImageOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code image upload and preview
 * Refactored to use useReducer instead of useState (reduced from 2 useState to 1 useReducer)
 * State resets when qrCode.imageUrl changes (handled by parent component key prop)
 */
export function useQRCodeImage({ qrCode, isOpen }: UseQRCodeImageOptions) {
  const imageUrl = qrCode.imageUrl || "";
  
  const initialState: QRCodeImageState = {
    editedImageUrl: imageUrl,
    imagePreview: imageUrl,
  };

  const [state, dispatch] = useReducer(qrCodeImageReducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State resets automatically when qrCode changes (parent component should use key={qrCode.id})

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      dispatch({ type: "SET_EDITED_IMAGE_URL", payload: dataUrl });
      dispatch({ type: "SET_IMAGE_PREVIEW", payload: dataUrl });
    };
    reader.readAsDataURL(file);
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
