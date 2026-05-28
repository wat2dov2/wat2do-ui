/**
 * Auth Feature
 * Public API for authentication
 *
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
export { AuthPageLayout } from "./components/AuthPageLayout";
export { AuthHeroPanel } from "./components/AuthHeroPanel";
export { AuthEmailFormCard } from "./components/AuthEmailFormCard";
export { ForgotPasswordFormCard } from "./components/ForgotPasswordFormCard";
export { PreviewStyleEventCard } from "./components/PreviewStyleEventCard";

// Pages
export { AuthEntryPage } from "./pages/AuthEntryPage";
export { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
export { ResetPasswordPage } from "./pages/ResetPasswordPage";

// Hooks
export { useAuthEntryFlow } from "./hooks/useAuthEntryFlow";
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
  initializeAuth,
  loginAPI,
  signupAPI,
  logoutAPI,
  fetchProfileAPI,
  updateProfileAPI,
  resetPasswordAPI,
  getLastProfileFetchAt,
  AUTH_STATE_REFRESH_EVENT,
  type UserProfile,
} from "./api/auth.api";

// Constants (shared)
export {
  PREVIEW_CARD_IMAGE_HEIGHT,
  HERO_CARD_PLACEHOLDER_HEIGHT,
} from "./constants";

// Utilities (shared)
export { eventToPreview } from "./utils/eventPreview";
export { shuffle } from "./utils/shuffle";

