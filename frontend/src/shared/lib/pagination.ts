import type { PaginatedApiResponse } from "@/shared/services/apiClient";

/** Complete discovery snapshots share one all-or-nothing page collector. */
export async function collectPaginatedPages<
  Page extends PaginatedApiResponse<{ id: number | string }>,
>(fetchPage: (page: number) => Promise<Page>): Promise<Page> {
  const firstPage = await fetchPage(1);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      fetchPage(index + 2),
    ),
  );
  const items = [...new Map(
    [firstPage, ...remainingPages]
      .flatMap((page) => page.items)
      .map((item) => [item.id, item]),
  ).values()];
  return {
    ...firstPage,
    items,
    total: items.length,
    page: 1,
    page_size: items.length,
    total_pages: 1,
  };
}
