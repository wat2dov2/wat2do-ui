import type { ApiPositionResponse } from "@/shared/generated";

export type PositionType = ApiPositionResponse["position_type"];

export type Position = Omit<ApiPositionResponse, "requirements"> & {
  requirements: string[];
};
