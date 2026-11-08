import { GooseDialogue } from "./GooseDialogue";
import { OnboardingFrame } from "./OnboardingFrame";
import { useOnboardingStepCount } from "../hooks/useOnboardingFlow";
import { useOnboardingSchool } from "../hooks/useOnboardingSchool";

const waitForPage = () => {};

/**
 * Onboarding before its page's code arrives: the page's own frame at its first
 * step, with the goose's line still to come.
 */
export function OnboardingLoading() {
  const totalSteps = useOnboardingStepCount(useOnboardingSchool());
  return (
    <OnboardingFrame currentStep={0} totalSteps={totalSteps} dialogue={<GooseDialogue onNext={waitForPage} showBack={false} />}>
      <div className="w-full min-h-[120px]" aria-hidden />
    </OnboardingFrame>
  );
}
