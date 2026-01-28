export interface QRCodeEditState {
  isEditing: boolean;
  editedName: string;
  editedDescription: string;
}

export type QRCodeEditAction =
  | { type: "SET_IS_EDITING"; payload: boolean }
  | { type: "SET_EDITED_NAME"; payload: string }
  | { type: "SET_EDITED_DESCRIPTION"; payload: string }
  | { type: "RESET"; payload: { name: string; description: string } };

export function qrCodeEditReducer(
  state: QRCodeEditState,
  action: QRCodeEditAction
): QRCodeEditState {
  switch (action.type) {
    case "SET_IS_EDITING":
      return { ...state, isEditing: action.payload };
    case "SET_EDITED_NAME":
      return { ...state, editedName: action.payload };
    case "SET_EDITED_DESCRIPTION":
      return { ...state, editedDescription: action.payload };
    case "RESET":
      return {
        isEditing: false,
        editedName: action.payload.name,
        editedDescription: action.payload.description,
      };
    default:
      return state;
  }
}
