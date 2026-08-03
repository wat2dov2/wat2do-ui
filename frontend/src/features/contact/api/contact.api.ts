import type { components } from "@/shared/generated/api-types";
import { api } from "@/shared/services/apiClient";

export type ContactMessage = components["schemas"]["ContactCreate"];

export async function submitContactMessage(
  message: ContactMessage,
): Promise<void> {
  await api.post<components["schemas"]["MessageResponse"]>(
    "/contact/",
    message,
  );
}
