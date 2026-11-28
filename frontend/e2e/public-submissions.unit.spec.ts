import { expect, test } from "@playwright/test";
import { ApiError, api } from "../src/shared/services/apiClient";
import { submitEventForReview } from "../src/features/events/api/events.api";
import { submitPosition } from "../src/features/positions/api/positions.api";
import { createClubAPI, existingClubFromError } from "../src/features/clubs/api/clubs.api";
import { saveUserEmail } from "../src/features/auth/api/userRepository";
import type { EventFormData } from "../src/shared/types";

// Every submission is sent by the signed-in account, whose email is the moderation contact.
// That private contact never becomes an event or position application contact.
test("submissions carry the signed-in account's email without inventing ownership", async () => {
  const original = api.post;
  const requests: { path: string; data: unknown }[] = [];
  api.post = async <T>(path: string, data?: unknown) => {
    requests.push({ path, data });
    return { id: 7, club_name: "Visitor Club", status: "pending" } as T;
  };
  saveUserEmail("visitor@example.com", false);
  try {
    await submitEventForReview({
      club_id: 7, title: "Visitor Event", description: "Details", location: "Campus", map_location: "Campus",
      timeZone: "America/Toronto", occurrences: [{ dtstart_local: "2026-12-01T12:00", dtend_local: "", tickets: true }],
      price: 0, food: [], registration: false, category: "Arts & Culture", tickets: { enabled: false, releases: [] },
      source_url: "https://example.com/event", source_image_url: "https://example.com/flyer.png",
    } as EventFormData);
    await submitPosition({
      club_id: 7, title: "Lead", description: "Join us", position_type: "committee",
      source_url: "https://example.com/role", contact_email: "applications@example.com",
    });
    await createClubAPI({
      club_name: "Visitor Club", school: "uwaterloo", categories: ["Arts & Culture"],
      club_page: "", ig: null, discord: null, club_type: "independent",
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
    saveUserEmail(null, false);
  }
});

// A school lists one club per Instagram account and per name: submitting either names that club.
test("a club the school already lists comes back as that club", async () => {
  const original = api.post;
  const listed = {
    detail: "This club is already on Wat2Do", club_id: 42, club_name: "Right to Play UofA", matched: "instagram",
  };
  api.post = async () => {
    throw new ApiError(409, listed);
  };
  try {
    const error = await createClubAPI({
      club_name: "Right To Play", school: "ualberta", categories: ["Community Service"],
      club_page: "", ig: "rtp_uofa", discord: null, club_type: "independent",
    }).catch((caught: unknown) => caught);
    expect(existingClubFromError(error)).toEqual(listed);
    expect(existingClubFromError(new ApiError(409, { detail: "Conflict" }))).toBeNull();
    expect(existingClubFromError(new Error("offline"))).toBeNull();
  } finally {
    api.post = original;
  }
});

// A name only like a listed club's is asked about; the sender's "it's a different club" sends it again with
// allow_similar_name, and a first submission never claims to be different.
test("a club sent again as a different club says so", async () => {
  const original = api.post;
  const sent: unknown[] = [];
  api.post = async <T>(_path: string, data?: unknown) => {
    sent.push(data);
    if (sent.length === 1) {
      throw new ApiError(409, {
        detail: "This club is already on Wat2Do", club_id: 32912,
        club_name: "Carleton Afghan Students Association", matched: "similar_name",
      });
    }
    return { id: 7, club_name: "Afghan Cultural Club", status: "pending" } as T;
  };
  const club = {
    club_name: "Afghan Cultural Club", school: "carleton", categories: ["Arts & Culture"],
    club_page: "", ig: null, discord: null, club_type: "independent",
  };
  try {
    const error = await createClubAPI(club).catch((caught: unknown) => caught);
    expect(existingClubFromError(error)).toMatchObject({ club_id: 32912, matched: "similar_name" });
    await createClubAPI(club, { allowSimilarName: true });
    expect(sent).toMatchObject([{ allow_similar_name: false }, { allow_similar_name: true }]);
  } finally {
    api.post = original;
  }
});
