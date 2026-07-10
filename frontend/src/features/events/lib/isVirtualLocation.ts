/** True when a location string refers to an online / virtual venue. */
export function isVirtualLocation(location: string): boolean {
  const normalized = location.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes("virtual") ||
    normalized.includes("zoom") ||
    normalized.includes("google meet") ||
    normalized.includes("online")
  );
}
