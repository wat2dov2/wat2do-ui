import type { ApiPositionResponse } from "@/shared/generated";
import type { Position } from "@/shared/types";

export function normalizePosition(raw: ApiPositionResponse): Position {
  return {
    ...raw,
    requirements: raw.requirements ?? [],
  };
}
