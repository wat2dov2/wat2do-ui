import { api } from "@/shared/services/apiClient";
import type { ApiFilterStateResponse, ApiEventFormDataResponse } from "@/shared/generated";

export type FilterState = ApiFilterStateResponse;
export type EventFormData = ApiEventFormDataResponse;

export async function generateFiltersWithAI(
  prompt: string,
  onChunk: (partialJson: string) => void
): Promise<FilterState> {
  const result = await api.post<FilterState>("/ai/generate-filters", { prompt });
  onChunk(JSON.stringify(result, null, 2));
  return result;
}

export async function generateEventWithAI(
  prompt: string,
  onChunk: (partialJson: string) => void
): Promise<EventFormData> {
  const result = await api.post<EventFormData>("/ai/generate-event", { prompt });
  onChunk(JSON.stringify(result, null, 2));
  return result;
}

export function isApiKeyConfigured(): boolean {
  return true;
}
