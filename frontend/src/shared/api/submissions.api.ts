import type { EventFormData } from "@/shared/types";
import type { ApiSubmissionResponse } from "@/shared/generated";
import { buildEventPayload } from "@/shared/api/eventPayload";
import { api } from "@/shared/services/apiClient";

export async function submitEventForReview(
  eventData: EventFormData,
  submittedByEmail: string,
): Promise<ApiSubmissionResponse> {
  return api.post<ApiSubmissionResponse>("/submissions/", {
    event_data: buildEventPayload(eventData),
    submitted_by_email: submittedByEmail.trim(),
  });
}
