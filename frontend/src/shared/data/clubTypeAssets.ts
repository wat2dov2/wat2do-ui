import { resolveSchool } from "@/shared/constants/schools";

export const INDEPENDENT_CLUB_TYPE = "independent";

const CLUB_TYPE_ASSET_DIRECTORY = "/icons/club-types";

/**
 * The single presentation registry for club types.
 *
 * Database/API values contain only `school` and `club_type`. The
 * combined signature selects the SVG filename here, so asset paths never leak
 * into the wire contract.
 */
const CLUB_TYPE_ASSET_FILE_BY_SIGNATURE = {
  "uwaterloo:wusa": "uwaterloo-wusa.svg",
  "utsg:utsu": "utoronto-utsu.svg",
  "utsc:scsu": "utsc-scsu.svg",
  "utm:utmsu": "utm-utmsu.svg",
  "ubc:ams": "ubc-ams.svg",
  "tmu:tmsu": "tmu-tmsu.svg",
  "ualberta:uasu": "ualberta-uasu.svg",
  "ulaval:cadeul": "laval-cadeul.svg",
  "mun:munsu": "memorial-munsu.svg",
  "sfu:sfss": "sfu-sfss.svg",
  "udem:faecum": "udem-faecum.svg",
  "umanitoba:umsu": "umanitoba-umsu.svg",
  "mcgill:ssmu": "mcgill-ssmu.svg",
  "mcmaster:msu": "mcmaster-msu.svg",
  "uwo:usc": "western-usc.svg",
  "queensu:ams": "queens-ams.svg",
  "carleton:cusa": "carleton-cusa.svg",
  "brocku:busu": "brock-busu.svg",
  "concordia:csu": "concordia-csu.svg",
  "dalhousie:dsu": "dalhousie-dsu.svg",
  "guelph:csa": "guelph-csa.svg",
  "wlu:wlusu": "wlu-wlusu.svg",
  "yorku:yfs": "york-yfs.svg",
  "ucalgary:su": "ucalgary-su.svg",
  "ottawa:uosu": "uottawa-uosu.svg",
  "usask:ussu": "usask-ussu.svg",
  "uvic:uvss": "uvic-uvss.svg",
  "uwindsor:uwsa": "windsor-uwsa.svg",
  "ontariotech:otsu": "ontariotech-otsu.svg",
  "ocadu:ocadsu": "ocad-ocadsu.svg",
  "cornell:sa": "cornell-sa.svg",
  "nyu:sga": "nyu-sga.svg",
  "upenn:ua": "upenn-ua.svg",
  "columbia:ccsc": "columbia-ccsc.svg",
  "mit:ua": "mit-ua.svg",
  "berkeley:asuc": "berkeley-asuc.svg",
} as const satisfies Record<string, string>;

export const CLUB_TYPE_SIGNATURES = Object.keys(
  CLUB_TYPE_ASSET_FILE_BY_SIGNATURE,
);

function normalizeClubType(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildClubTypeSignature(
  school: string | null | undefined,
  clubType: string | null | undefined,
): string | null {
  const normalizedType = normalizeClubType(clubType);
  if (!normalizedType || normalizedType === INDEPENDENT_CLUB_TYPE) {
    return null;
  }
  return `${resolveSchool(school)}:${normalizedType}`;
}

export function getClubTypeAssetPath(
  school: string | null | undefined,
  clubType: string | null | undefined,
): string | null {
  const signature = buildClubTypeSignature(school, clubType);
  if (!signature) return null;
  const fileName =
    CLUB_TYPE_ASSET_FILE_BY_SIGNATURE[
      signature as keyof typeof CLUB_TYPE_ASSET_FILE_BY_SIGNATURE
    ];
  return fileName ? `${CLUB_TYPE_ASSET_DIRECTORY}/${fileName}` : null;
}

export function getSchoolClubType(
  school: string | null | undefined,
): string | null {
  const prefix = `${resolveSchool(school)}:`;
  const signature = CLUB_TYPE_SIGNATURES.find((value) =>
    value.startsWith(prefix),
  );
  return signature?.slice(prefix.length) ?? null;
}

export function getClubTypeFilterOptions(
  school: string | null | undefined,
): string[] {
  const resolvedSchool = school ? resolveSchool(school) : null;
  const mappedTypes = CLUB_TYPE_SIGNATURES.flatMap((signature) => {
    const [signatureSchool, clubType] = signature.split(":");
    return !resolvedSchool || signatureSchool === resolvedSchool
      ? [clubType]
      : [];
  });
  return [
    INDEPENDENT_CLUB_TYPE,
    ...Array.from(new Set(mappedTypes)).sort(),
  ];
}
