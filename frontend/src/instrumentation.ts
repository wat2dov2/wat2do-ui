export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.PLAYWRIGHT_TEST === "1" ||
    (process.env.NODE_ENV !== "production" && !process.env.STORAGE_BUCKET_NAME)
  )
    return;

  const { initializeDiscoverySnapshots } =
    await import("@/app/discoveryRefresh.server");
  await initializeDiscoverySnapshots();
}
