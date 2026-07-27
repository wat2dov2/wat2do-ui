import { QP } from "@/shared/constants/queryParams";

const RETURN_TO_ORIGIN = "https://wat2do.local";

export function getSafeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(value, RETURN_TO_ORIGIN);
    if (url.origin !== RETURN_TO_ORIGIN) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function appendSafeReturnTo(path: string, returnTo: string | null | undefined): string {
  const safeReturnTo = getSafeReturnTo(returnTo);
  if (!safeReturnTo) {
    return path;
  }

  const url = new URL(path, RETURN_TO_ORIGIN);
  url.searchParams.set(QP.RETURN_TO, safeReturnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}
