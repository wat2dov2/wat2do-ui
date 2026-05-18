/**
 * Auth Feature
 * Public API for authentication and onboarding
 *
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
export { AuthPageLayout } from "./components/AuthPageLayout";
export { AuthHeroPanel } from "./components/AuthHeroPanel";
export { AuthEmailFormCard } from "./components/AuthEmailFormCard";
export { ForgotPasswordFormCard } from "./components/ForgotPasswordFormCard";
export { OnboardingFacultyStep } from "./components/OnboardingFacultyStep";
export { GooseDialogue } from "./components/GooseDialogue";

// Pages
export { AuthEntryPage } from "./pages/AuthEntryPage";
export { OnboardingPage } from "./pages/OnboardingPage";
export { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
export { ResetPasswordPage } from "./pages/ResetPasswordPage";

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
  resetPasswordAPI,
  setDailyNewEventsEmailPreferenceAPI,
  getLastProfileFetchAt,
  AUTH_STATE_REFRESH_EVENT,
  type UserProfile,
} from "./api/auth.api";
