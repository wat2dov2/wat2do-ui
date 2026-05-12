import { useEffect, useReducer } from "react";

type QueryState<T> = { data: T; loading: boolean; error: Error | null };

type QueryAction<T> =
  | { type: "fetch_start" }
  | { type: "fetch_success"; data: T }
  | { type: "fetch_error"; error: Error; initialValue: T };

function queryReducer<T>(state: QueryState<T>, action: QueryAction<T>): QueryState<T> {
  switch (action.type) {
    case "fetch_start":
      return { ...state, loading: true, error: null };
    case "fetch_success":
      return { data: action.data, loading: false, error: null };
    case "fetch_error":
      return { data: action.initialValue, loading: false, error: action.error };
  }
}

/**
 * Generic fetch hook that deduplicates the loading/error/data pattern
 * used by backend query hooks.
 */
export function useBackendQuery<T>(
  fetchFn: () => Promise<T>,
  initialValue: T,
  refreshKey?: number,
): QueryState<T> {
  const [state, dispatch] = useReducer(queryReducer<T>, {
    data: initialValue,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "fetch_start" });
    fetchFn()
      .then((result) => {
        if (!cancelled) dispatch({ type: "fetch_success", data: result });
      })
      .catch((err) => {
        console.error("useBackendQuery fetch failed:", err);
        if (!cancelled) {
          dispatch({
            type: "fetch_error",
            error: err instanceof Error ? err : new Error(String(err)),
            initialValue,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return state;
}
