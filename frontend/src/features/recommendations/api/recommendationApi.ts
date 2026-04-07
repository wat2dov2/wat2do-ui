import { api } from "@/shared/services/apiClient";
import type { RecommendationItem } from "../types";

/** Must match backend DEFAULT_LIMIT in services/recommender/config.py */
const DEFAULT_RECOMMENDATION_LIMIT = 20;

export async function fetchRecommendations(
  limit = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<RecommendationItem[]> {
  return api.get<RecommendationItem[]>(
    `/recommendations/?limit=${limit}`,
  );
}
