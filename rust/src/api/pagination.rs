//! `core/pagination.py`: page parameters, the paginated envelope, a stable
//! SQL ordering, and bounded exhaustive reads.

use std::future::Future;

use serde::Serialize;

use super::errors::ApiError;
use super::validation::{Limits, QueryParams, Validator};
use crate::constants::{DEFAULT_PAGE_SIZE, MAX_PAGE_NUMBER, MAX_PAGE_SIZE};

/// Rows per page of an exhaustive read, and the default cap on its total.
pub const LOAD_PAGE_SIZE: i64 = 1000;
pub const DEFAULT_MAX_ROWS: usize = 100_000;

/// `PaginationParams`: `?page=` (1-indexed, at most 1000) and `?page_size=` (at most 100).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pagination {
    pub page: i64,
    pub page_size: i64,
}

impl Pagination {
    /// Read both parameters, recording any problem on `check`.
    pub fn read(check: &mut Validator, query: &QueryParams) -> Self {
        Self {
            page: check
                .query(query, "page")
                .int_or(1, Limits::default().ge(1).le(MAX_PAGE_NUMBER)),
            page_size: check
                .query(query, "page_size")
                .int_or(DEFAULT_PAGE_SIZE, Limits::default().ge(1).le(MAX_PAGE_SIZE)),
        }
    }

    /// Zero-based row offset of the page.
    pub fn offset(&self) -> i64 {
        (self.page - 1) * self.page_size
    }
}

/// `PaginatedResponse`: one page of items and the totals.
#[derive(Debug, Serialize, PartialEq)]
pub struct Paginated<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

impl<T> Paginated<T> {
    /// `paginated_response`.
    pub fn new(items: Vec<T>, total: i64, pagination: Pagination) -> Self {
        let total_pages = if total > 0 {
            (total + pagination.page_size - 1) / pagination.page_size
        } else {
            0
        };
        Self {
            items,
            total,
            page: pagination.page,
            page_size: pagination.page_size,
            total_pages,
        }
    }
}

/// `apply_stable_order`: an `ORDER BY` with a unique tiebreaker, so offset
/// pages cannot drift when primary values tie. Columns are code constants.
pub fn stable_order(primary: &str, descending: bool, tiebreaker: &str) -> String {
    let direction = if descending { "DESC" } else { "ASC" };
    format!("ORDER BY {primary} {direction}, {tiebreaker} {direction}")
}

/// `fetch_all_pages`: read pages of `page_size` until a partial page,
/// refusing a full page beyond `max_rows` rather than return an incomplete result.
pub async fn fetch_all_pages<T, F, Fut>(
    mut query: F,
    page_size: i64,
    max_rows: usize,
) -> Result<Vec<T>, ApiError>
where
    F: FnMut(i64, i64) -> Fut,
    Fut: Future<Output = Result<Vec<T>, ApiError>>,
{
    if max_rows == 0 {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "max_rows must be positive"
        )));
    }
    let mut rows = Vec::new();
    let mut offset = 0;
    loop {
        let page = query(offset, page_size).await?;
        let full = page.len() as i64 == page_size;
        for row in page {
            rows.push(row);
            if rows.len() >= max_rows && full {
                tracing::warn!(
                    "fetch_all_pages: exceeded max_rows={max_rows} - refusing to yield more rows (query may be misconfigured)"
                );
                return Err(ApiError::Internal(anyhow::anyhow!(
                    "fetch_all_pages exceeded max_rows={max_rows}"
                )));
            }
        }
        if !full {
            return Ok(rows);
        }
        offset += page_size;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn pagination_defaults_bounds_and_offset() {
        let mut check = Validator::default();
        let pagination = Pagination::read(&mut check, &QueryParams::parse(None));
        assert_eq!(
            pagination,
            Pagination {
                page: 1,
                page_size: 50
            }
        );
        assert!(check.finish().is_ok());

        let mut check = Validator::default();
        let pagination =
            Pagination::read(&mut check, &QueryParams::parse(Some("page=3&page_size=20")));
        assert_eq!(pagination.offset(), 40);

        let mut check = Validator::default();
        Pagination::read(
            &mut check,
            &QueryParams::parse(Some("page=0&page_size=101")),
        );
        assert!(check.finish().is_err());
    }

    #[test]
    fn envelope_counts_pages() {
        let pagination = Pagination {
            page: 2,
            page_size: 10,
        };
        let page = Paginated::new(vec![1, 2], 21, pagination);
        assert_eq!(page.total_pages, 3);
        assert_eq!(Paginated::<i32>::new(vec![], 0, pagination).total_pages, 0);
        assert_eq!(Paginated::<i32>::new(vec![], 20, pagination).total_pages, 2);
    }

    #[test]
    fn stable_order_appends_the_tiebreaker() {
        assert_eq!(
            stable_order("submitted_at", true, "id"),
            "ORDER BY submitted_at DESC, id DESC"
        );
        assert_eq!(
            stable_order("dtstart_utc", false, "id"),
            "ORDER BY dtstart_utc ASC, id ASC"
        );
        assert_eq!(
            stable_order("name", true, "uuid"),
            "ORDER BY name DESC, uuid DESC"
        );
    }

    async fn load(
        row_count: i64,
        page_size: i64,
        max_rows: usize,
    ) -> (Result<Vec<i64>, ApiError>, Vec<i64>) {
        let offsets = Mutex::new(Vec::new());
        let result = fetch_all_pages(
            |offset, limit| {
                offsets.lock().unwrap().push(offset);
                assert_eq!(limit, page_size);
                async move { Ok((offset..(offset + limit).min(row_count)).collect()) }
            },
            page_size,
            max_rows,
        )
        .await;
        (result, offsets.into_inner().unwrap())
    }

    #[tokio::test]
    async fn pagination_boundaries_match_python() {
        // backend/tests/core/test_pagination.py::test_pagination_boundaries
        for page_size in [1, 2, 5] {
            for row_count in [0, 1, 2, 4, 5, 8] {
                for max_rows in [1usize, 3, 5, 10] {
                    let (result, offsets) = load(row_count, page_size, max_rows).await;
                    let full_page_rows = row_count / page_size * page_size;
                    let expected_calls = if full_page_rows as usize >= max_rows {
                        assert!(result.is_err());
                        (max_rows as i64 + page_size - 1) / page_size
                    } else {
                        assert_eq!(result.unwrap(), (0..row_count).collect::<Vec<_>>());
                        row_count / page_size + 1
                    };
                    let expected: Vec<i64> =
                        (0..expected_calls).map(|index| index * page_size).collect();
                    assert_eq!(offsets, expected, "{page_size} {row_count} {max_rows}");
                }
            }
        }
    }

    #[tokio::test]
    async fn query_errors_propagate_and_zero_cap_is_rejected() {
        let result: Result<Vec<i64>, ApiError> = fetch_all_pages(
            |offset, size| async move {
                if offset > 0 {
                    Err(ApiError::Internal(anyhow::anyhow!("storage unavailable")))
                } else {
                    Ok((0..size).collect())
                }
            },
            2,
            DEFAULT_MAX_ROWS,
        )
        .await;
        assert!(format!("{:?}", result.unwrap_err()).contains("storage unavailable"));
        let (result, _) = load(3, 2, 0).await;
        assert!(format!("{:?}", result.unwrap_err()).contains("max_rows must be positive"));
    }
}
