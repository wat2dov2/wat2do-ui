/**
 * Auth Feature
 * Public API for authentication and onboarding
 * 
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
/** @deprecated Use `OnboardingPage` route-based flow instead. */
export { OnboardingModal } from "./components/OnboardingModal";
export { AuthHeroPanel } from "./components/AuthHeroPanel";
export { AuthEmailFormCard } from "./components/AuthEmailFormCard";
export { OnboardingTopicsStep } from "./components/OnboardingTopicsStep";
export { OnboardingFacultyStep } from "./components/OnboardingFacultyStep";
export { OnboardingYearStep } from "./components/OnboardingYearStep";
export { OnboardingDoneStep } from "./components/OnboardingDoneStep";
export { GooseDialogue } from "./components/GooseDialogue";

// Pages
export { AuthEntryPage } from "./pages/AuthEntryPage";
export { OnboardingPage } from "./pages/OnboardingPage";

// Hooks
export { useAuthEntryFlow } from "./hooks/useAuthEntryFlow";
export {
  useOnboardingFlow,
  FACULTY_OPTIONS,
  ONBOARDING_TOTAL_STEPS,
} from "./hooks/useOnboardingFlow";

// Hooks (auth)
export { useAuth } from "./hooks/useAuth";

// API (public interface)
export { 
  login, 
  logout, 
  getSession,
  getUserProfile,
  updateUserProfile,
  isAuthenticated,
  isProfileCompleted,
  loginAPI,
  signupAPI,
  logoutAPI,
  fetchProfileAPI,
  updateProfileAPI,
  type UserProfile,
} from "./api/auth.api";
