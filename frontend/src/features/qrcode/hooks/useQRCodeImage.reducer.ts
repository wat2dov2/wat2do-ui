import type { QRCode } from "@/shared/types";

export interface QRCodeImageState {
  editedImageUrl: string;
  imagePreview: string;
}

export type QRCodeImageAction =
  | { type: "SET_EDITED_IMAGE_URL"; payload: string }
  | { type: "SET_IMAGE_PREVIEW"; payload: string }
  | { type: "REMOVE_IMAGE" }
  | { type: "RESET"; payload: { imageUrl: string } };

export function qrCodeImageReducer(
  state: QRCodeImageState,
  action: QRCodeImageAction
): QRCodeImageState {
  switch (action.type) {
    case "SET_EDITED_IMAGE_URL":
      return { ...state, editedImageUrl: action.payload };
    case "SET_IMAGE_PREVIEW":
      return { ...state, imagePreview: action.payload };
    case "REMOVE_IMAGE":
      return { editedImageUrl: "", imagePreview: "" };
    case "RESET":
      return {
        editedImageUrl: action.payload.imageUrl || "",
        imagePreview: action.payload.imageUrl || "",
      };
    default:
      return state;
  }
}
