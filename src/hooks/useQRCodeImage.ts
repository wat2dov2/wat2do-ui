import React, { useState, useRef, useCallback, useEffect } from "react";
import type { QRCode } from "@/types";

interface UseQRCodeImageOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code image upload and preview
 */
export function useQRCodeImage({ qrCode, isOpen }: UseQRCodeImageOptions) {
  const [editedImageUrl, setEditedImageUrl] = useState(qrCode.imageUrl || "");
  const [imagePreview, setImagePreview] = useState(qrCode.imageUrl || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setEditedImageUrl(qrCode.imageUrl || "");
      setImagePreview(qrCode.imageUrl || "");
    }
  }, [isOpen, qrCode.imageUrl]);

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
      setEditedImageUrl(dataUrl);
      setImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setEditedImageUrl("");
    setImagePreview("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return {
    editedImageUrl,
    setEditedImageUrl,
    imagePreview,
    fileInputRef,
    handleImageUpload,
    handleRemoveImage,
  };
}
