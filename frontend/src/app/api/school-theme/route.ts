import { headers } from "next/headers";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";

export const dynamic = "force-dynamic";

function themeStyles(primaryColor: string, secondaryColor: string): string {
  return `:root{--page-school-primary:${primaryColor};--page-school-secondary:${secondaryColor}}`;
}

export async function GET() {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );

  let stylesheet = "";
  try {
    const schoolRecord = await getSchool(school);
    if (schoolRecord) {
      stylesheet = themeStyles(
        schoolRecord.primary_color,
        schoolRecord.secondary_color,
      );
    }
  } catch (error) {
    console.error("School theme fetch failed:", error);
  }

  return new Response(stylesheet, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/css; charset=utf-8",
    },
  });
}
