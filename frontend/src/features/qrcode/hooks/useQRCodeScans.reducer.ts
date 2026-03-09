import type { QRCodeScan } from "@/shared/types";

export interface QRCodeScansState {
  scans: QRCodeScan[];
  timeRange: string;
}

export type QRCodeScansAction =
  | { type: "SET_SCANS"; payload: QRCodeScan[] }
  | { type: "SET_TIME_RANGE"; payload: string }
  | { type: "RESET" };

const initialState: QRCodeScansState = {
  scans: [],
  timeRange: "30",
};

export function qrCodeScansReducer(
  state: QRCodeScansState,
  action: QRCodeScansAction
): QRCodeScansState {
  switch (action.type) {
    case "SET_SCANS":
      return { ...state, scans: action.payload };
    case "SET_TIME_RANGE":
      return { ...state, timeRange: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export { initialState };
