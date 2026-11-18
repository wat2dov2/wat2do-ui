import { getSchoolDirectory } from "@/shared/api/schools.server";
import { buildBrandStructuredData } from "@/shared/lib/seo";
import { StructuredData } from "@/shared/ui/structured-data";

/**
 * Wat2Do's Organization and WebSite structured data, naming every school's
 * Wat2Do Instagram account. Without the school directory it still names the
 * brand and its other profiles.
 */
export async function BrandStructuredData() {
  const schools = await getSchoolDirectory().catch((error: unknown) => {
    console.error("Brand structured data school directory fetch failed:", error);
    return [];
  });
  return <StructuredData data={buildBrandStructuredData(schools)} />;
}
