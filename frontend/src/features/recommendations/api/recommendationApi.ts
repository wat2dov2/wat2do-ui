import { api } from "@/shared/services/apiClient";
import type { RecommendationItem } from "../types";

export async function fetchRecommendations(
  limit = 20,
  lambda = 0.7,
): Promise<RecommendationItem[]> {
  return api.get<RecommendationItem[]>(
    `/recommendations/?limit=${limit}&lambda=${lambda}`,
  );
}
