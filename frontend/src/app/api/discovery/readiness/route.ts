import { NextResponse } from "next/server";
import { discoveryReadiness } from "@/app/discoveryRefresh.server";
export async function GET() {
  try {
    const coverage = await discoveryReadiness();
    return NextResponse.json(coverage, {
      status: coverage.ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { ready: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
