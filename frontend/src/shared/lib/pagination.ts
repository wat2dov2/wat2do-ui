import controls from "../../../../backend/controlbox/discovery_cache.json" with { type: "json" };
import type { PaginatedApiResponse } from "@/shared/services/apiClient";

/** Complete discovery snapshots share one all-or-nothing page collector. */
export async function collectPaginatedPages<
  Page extends PaginatedApiResponse<{ id: number | string }>,
>(fetchPage: (page: number) => Promise<Page>): Promise<Page> {
  const firstPage = await fetchPage(1);
  if (firstPage.total_pages > controls.maximum_page_count)
    throw new Error("Discovery page limit exceeded");
  const remainingPages: Page[] = [];
  for (
    let start = 2;
    start <= firstPage.total_pages;
    start += controls.page_concurrency
  ) {
    const pages = await Promise.all(
      Array.from(
        {
          length: Math.min(
            controls.page_concurrency,
            firstPage.total_pages - start + 1,
          ),
        },
        (_, index) => fetchPage(start + index),
      ),
    );
    if (pages.some((page) => page.total !== firstPage.total))
      throw new Error(
        "Discovery changed during pagination; retry the complete snapshot",
      );
    remainingPages.push(...pages);
  }
  const items = [
    ...new Map(
      [firstPage, ...remainingPages]
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  if (items.length !== firstPage.total)
    throw new Error("Incomplete discovery snapshot");
  return {
    ...firstPage,
    items,
    total: items.length,
    page: 1,
    page_size: items.length,
    total_pages: 1,
  };
}
