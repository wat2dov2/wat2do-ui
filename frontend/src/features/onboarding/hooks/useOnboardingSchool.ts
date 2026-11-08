import { useSearchParams } from "next/navigation";
import { useRequestSchool } from "@/app/client-providers";
import { QP } from "@/shared/constants/queryParams";

/**
 * The school onboarding is for: the one sign-up handed over in the address (so
 * a refresh keeps its greeting), else the school whose site this is, as for a
 * visitor who skipped sign-in.
 */
export function useOnboardingSchool(): string {
  const searchParams = useSearchParams();
  const requestSchool = useRequestSchool();
  return searchParams.get(QP.SCHOOL) || requestSchool;
}
