import { api } from "@/shared/services/apiClient";
import { DEFAULT_RECOMMENDATION_LIMIT } from "@/features/recommendations/constants";
import type { RecommendationItem } from "../types";

export async function fetchRecommendations(
  limit = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<RecommendationItem[]> {
  return api.get<RecommendationItem[]>(
    `/recommendations/?limit=${limit}`,
  );
}
