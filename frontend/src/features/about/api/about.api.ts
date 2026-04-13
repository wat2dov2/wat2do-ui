import { api } from "@/shared/services/apiClient";

/**
 * Subscribe an email address to the newsletter.
 */
export async function subscribeToNewsletter(email: string): Promise<void> {
  await api.post("/newsletter/subscribe", { email });
}
