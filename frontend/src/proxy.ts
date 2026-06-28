import { NextResponse, type NextRequest } from "next/server";
import { getHostnameSchoolStatus } from "@/shared/constants/schools";

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.hostname;
  const schoolStatus = getHostnameSchoolStatus(hostname);
  if (!schoolStatus.candidate) {
    return NextResponse.next();
  }

  url.pathname = `/school/${schoolStatus.school}`;
  url.host = request.headers.get("host") ?? request.nextUrl.host;
  url.protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/"],
};
