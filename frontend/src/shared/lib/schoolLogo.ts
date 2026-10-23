import type { SchoolSummary } from "@/shared/api/schools.api";
import { controlBox } from "@/shared/config/controlBox";
import imgWat2DoLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

export interface SchoolLogoImage {
  src: string;
  width: number;
  height: number;
}

/** The school's poster-built logo when it has one, otherwise the standard wat2do logo. */
export function getSchoolLogoImage(
  school?: Pick<SchoolSummary, "poster_logo_url">,
): SchoolLogoImage {
  if (!school?.poster_logo_url) {
    return { src: imgWat2DoLogo.src, width: imgWat2DoLogo.width, height: imgWat2DoLogo.height };
  }
  return {
    src: school.poster_logo_url,
    width: controlBox.schoolLogos.outputWidth,
    height: controlBox.schoolLogos.outputHeight,
  };
}
