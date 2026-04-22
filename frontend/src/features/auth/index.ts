/**
 * Auth Feature
 * Public API for authentication and onboarding
 *
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
export { AuthHeroPanel } from "./components/AuthHeroPanel";
export { AuthEmailFormCard } from "./components/AuthEmailFormCard";
export { OnboardingFacultyStep } from "./components/OnboardingFacultyStep";
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
export {
  useAuthState,
  useUserEmail,
  useProfileCompleted,
  useIsAdmin,
  useHasClub,
  type AuthState,
} from "./hooks/useAuthState";

// API (public interface)
export {
  getSessionEmail,
  getUserProfile,
  getUserId,
  getUserRole,
  getUserHasClub,
  updateUserProfile,
  isAuthenticated,
  isProfileCompleted,
  loginAPI,
  signupAPI,
  logoutAPI,
  fetchProfileAPI,
  updateProfileAPI,
  getLastProfileFetchAt,
  AUTH_STATE_REFRESH_EVENT,
  type UserProfile,
} from "./api/auth.api";
