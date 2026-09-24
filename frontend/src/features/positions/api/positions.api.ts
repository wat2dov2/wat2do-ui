import type {
  ApiPaginatedPositionResponse,
  ApiPositionCreate,
  ApiPositionSubmissionResponse,
} from "@/shared/generated";
import type { Position, PositionType } from "@/shared/types";
import { collectPositionPages, normalizePosition } from "@/features/positions/api/positionService";
import { controlBox } from "@/shared/config/controlBox";
import { api } from "@/shared/services/apiClient";
export { parsePositionImage } from "@/shared/services/uploadService";
export const POSITION_TYPES: PositionType[] = ["executive", "committee", "volunteer", "staff", "internship", "general"];

export function submitPosition(data: ApiPositionCreate): Promise<ApiPositionSubmissionResponse> {
  return api.post<ApiPositionSubmissionResponse>("/position-submissions/", { position_data: data });
}

export type PaginatedPositionsResponse = Omit<ApiPaginatedPositionResponse, "items"> & {
  items: Position[];
};

interface PositionListOptions {
  page: number;
  school?: string;
  clubId?: number;
  pageSize?: number;
  search?: string;
  includeClosed?: boolean;
  sortOrder?: "asc" | "desc";
}

export async function getPositionsPage(
  options: PositionListOptions,
): Promise<PaginatedPositionsResponse> {
  const params = new URLSearchParams({
    page: String(options.page),
    page_size: String(options.pageSize ?? controlBox.eventDiscovery.serverFeedPageSize),
  });
  if (options.sortOrder) params.set("sort_order", options.sortOrder);
  if (options.school) params.set("school", options.school);
  if (options.search) params.set("search", options.search);
  if (options.includeClosed) params.set("include_closed", "true");
  if (options.clubId != null) {
    params.set("club_id", String(options.clubId));
  }

  const query = params.toString();
  const response = await api.get<ApiPaginatedPositionResponse>(
    `/positions/${query ? `?${query}` : ""}`,
  );
  return {
    ...response,
    items: response.items.map(normalizePosition),
  };
}

export async function getClubPositions(
  clubId: number,
  school: string,
): Promise<Position[]> {
  const directory = await collectPositionPages((page) =>
    getPositionsPage({ clubId, school, page }),
  );
  return directory.items;
}

export function getPositionDirectory(school: string): Promise<PaginatedPositionsResponse> {
  return collectPositionPages((page) => getPositionsPage({ school, page }));
}
