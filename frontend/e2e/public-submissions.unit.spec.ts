import { expect, test } from "@playwright/test";
import { api } from "../src/shared/services/apiClient";
import { submitEventForReview } from "../src/shared/api/submissions.api";
import { submitPosition } from "../src/features/positions/api/positions.api";
import { createClubAPI } from "../src/features/clubs/api/clubs.api";
import type { EventFormData } from "../src/shared/types";

// Private moderation contact never becomes an event or position application contact.
test("public submission APIs send explicit email without inventing ownership", async () => {
  const original = api.post;
  const requests: { path: string; data: unknown }[] = [];
  api.post = async <T>(path: string, data?: unknown) => {
    requests.push({ path, data });
    return { id: 7, club_name: "Visitor Club", status: "pending" } as T;
  };
  try {
    await submitEventForReview({
      club_id: 7, title: "Visitor Event", description: "Details", location: "Campus",
      timeZone: "America/Toronto", occurrences: [{ dtstart_local: "2026-12-01T12:00", dtend_local: "" }],
      price: 0, food: [], registration: false, category: "Arts & Culture",
      source_url: "https://example.com/event", source_image_url: "https://example.com/flyer.png",
    } as EventFormData, " visitor@example.com ");
    await submitPosition({
      club_id: 7, title: "Lead", description: "Join us", position_type: "committee",
      source_url: "https://example.com/role", contact_email: "applications@example.com",
    }, " visitor@example.com ");
    await createClubAPI({
      club_name: "Visitor Club", school: "uwaterloo", categories: ["Arts & Culture"],
      club_page: "", ig: null, discord: null, club_type: "independent",
      submitted_by_email: "visitor@example.com",
    });
    expect(requests.map(request => request.path)).toEqual(["/submissions/", "/position-submissions/", "/clubs/"]);
    for (const request of requests) {
      expect(request.data).toMatchObject({ submitted_by_email: "visitor@example.com" });
      expect(request.data).not.toHaveProperty("user_id");
      expect(request.data).not.toHaveProperty("created_by");
    }
    expect(requests[0].data).not.toHaveProperty("event_data.submitted_by_email");
    expect(requests[1].data).toMatchObject({ position_data: { contact_email: "applications@example.com" } });
    expect(requests[1].data).not.toHaveProperty("position_data.submitted_by_email");
  } finally {
    api.post = original;
  }
});
