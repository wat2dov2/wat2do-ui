// Vercel only. The CI/CD deploy job copies this file to frontend/src/proxy.ts
// just before `vercel deploy` (docs/projects/mac-mini-hosting.md, "Visitor
// addresses"); the Mac's and AWS's builds never include it.
import { BlockList, isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import viewerIp from "../../backend/controlbox/viewer_ip.json" with { type: "json" };

const VIEWER_IP_HEADER = "x-wat2do-viewer-ip";
const ORIGIN_VERIFY_HEADER = "x-wat2do-origin-verify";

const cloudflare = new BlockList();
for (const network of viewerIp.cloudflare_networks) {
  const [address, prefix] = network.split("/");
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? "ipv6" : "ipv4");
}

function inCloudflare(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && cloudflare.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * The visitor's address. Vercel overwrites `x-real-ip` with whoever connected
 * to it: Cloudflare's edge for wat2do.io, whose `CF-Connecting-IP` then names
 * the visitor. Anyone reaching Vercel without Cloudflare is their own address,
 * so a forged `CF-Connecting-IP` is ignored.
 */
function viewerAddress(headers: Headers): string | null {
  const connecting = headers.get("x-real-ip")?.trim() ?? "";
  if (!isIP(connecting)) return null;
  if (!inCloudflare(connecting)) return connecting;
  const visitor = headers.get("cf-connecting-ip")?.trim() ?? "";
  return isIP(visitor) ? visitor : null;
}

/**
 * Tells the API (behind Caddy on the Mac, infra/mac-mini/Caddyfile) who sent
 * each /api request, so per-visitor limits do not collapse onto Vercel's
 * addresses. Caddy honors `X-Wat2Do-Viewer-Ip` only beside the shared
 * `X-Wat2Do-Origin-Verify` secret, and replaces both otherwise. Without
 * ORIGIN_VERIFY_SECRET (local development, the Mac's own Next) requests pass
 * through untouched.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.ORIGIN_VERIFY_SECRET?.trim();
  if (!secret) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set(ORIGIN_VERIFY_HEADER, secret);
  const viewer = viewerAddress(request.headers);
  if (viewer) headers.set(VIEWER_IP_HEADER, viewer);
  else headers.delete(VIEWER_IP_HEADER);
  return NextResponse.next({ request: { headers } });
}

// Every /api path the rewrite sends to the API; Next's own /api routes skip it.
export const config = {
  matcher: "/api/((?!discovery$|revalidate-events$|render-instagram-slide$).*)",
};
