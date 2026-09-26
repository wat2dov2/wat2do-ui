/**
 * Auth Feature
 * Public API for authentication
 *
 * This is the feature's public interface.
 * Other features should only import from here.
 */

// Components
export { EmailOtpForm } from "./components/EmailOtpForm";
export { PreviewStyleEventCard } from "./components/PreviewStyleEventCard";

// Hooks
export {
  useAuthState,
  useUserEmail,
} from "./hooks/useAuthState";

// API (public interface)
export {
  getSessionEmail,
  getUserProfile,
  updateUserProfile,
  fetchProfileAPI,
  updateProfileAPI,
  getLastProfileFetchAt,
  type UserProfile,
} from "./api/auth.api";

// Constants (shared)
export {
  HERO_CARD_PLACEHOLDER_HEIGHT,
} from "./constants";

// Utilities (shared)
export { eventToPreview } from "./utils/eventPreview";
export { shuffle } from "./utils/shuffle";
export { appendSafeReturnTo } from "./utils/returnTo";
