import type {
  ApiPaginatedPositionResponse,
  ApiPositionResponse,
} from "@/shared/generated";
import type { Position, PositionType } from "@/shared/types";
import { normalizePosition } from "@/features/positions/api/positionService";
import { api } from "@/shared/services/apiClient";

export interface PaginatedPositionsResponse {
  items: Position[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PositionListOptions {
  page?: number;
  pageSize?: number;
  school?: string;
  search?: string;
  positionType?: PositionType;
  organizationId?: number;
  includeClosed?: boolean;
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
  if (options.organizationId != null) {
    params.set("organization_id", String(options.organizationId));
  }
  if (options.includeClosed) params.set("include_closed", "true");

  const query = params.toString();
  const response = await api.get<ApiPaginatedPositionResponse>(
    `/positions/${query ? `?${query}` : ""}`,
  );
  return {
    ...response,
    items: response.items.map(normalizePosition),
  };
}

export async function getPosition(positionId: number): Promise<Position> {
  const response = await api.get<ApiPositionResponse>(
    `/positions/${positionId}`,
  );
  return normalizePosition(response);
}

export async function getOrganizationPositions(
  organizationId: number,
  school: string,
): Promise<Position[]> {
  const firstPage = await getPositionsPage({ organizationId, school, page: 1 });
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      getPositionsPage({ organizationId, school, page: index + 2 }),
    ),
  );

  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}
