import type {
  ApiPaginatedPositionResponse,
  ApiPositionCreate,
  ApiPositionSubmissionResponse,
} from "@/shared/generated";
import type { Position, PositionType } from "@/shared/types";
import { normalizePosition } from "@/features/positions/api/positionService";
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
  page?: number;
  pageSize?: number;
  school?: string;
  search?: string;
  positionType?: PositionType;
  clubId?: number;
  includeClosed?: boolean;
  addedSince?: string;
  paidOnly?: boolean;
}

export async function getPositionsPage(
  options: PositionListOptions = {},
): Promise<PaginatedPositionsResponse> {
  const params = new URLSearchParams();
  if (options.page != null) params.set("page", String(options.page));
  if (options.pageSize != null)
    params.set("page_size", String(options.pageSize));
  if (options.school) params.set("school", options.school);
  if (options.search) params.set("search", options.search);
  if (options.positionType) params.set("position_type", options.positionType);
  if (options.clubId != null) {
    params.set("club_id", String(options.clubId));
  }
  if (options.includeClosed) params.set("include_closed", "true");
  if (options.addedSince) params.set("added_since", options.addedSince);
  if (options.paidOnly) params.set("paid_only", "true");

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
  const firstPage = await getPositionsPage({ clubId, school, page: 1 });
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      getPositionsPage({ clubId, school, page: index + 2 }),
    ),
  );

  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}
