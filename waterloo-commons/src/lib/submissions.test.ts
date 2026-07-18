import { describe, expect, it } from "vitest";
import { DEFAULT_POST } from "@/lib/post";
import {
  createSubmissionCursor,
  isSubmissionStatus,
  MAX_COVER_IMAGE_SIZE_BYTES,
  normaliseEventSubmissionFields,
  parseEventSubmissionFields,
  parseSubmissionFinalize,
  parseSubmissionListQuery,
  parseSubmissionUploadIntent,
  parseSubmissionUpdate,
} from "@/lib/submissions";

const event = {
  title: "Canvas Designathon",
  hosts: "UW Blueprint",
  date: "Sun, Nov 16",
  time: "9:00 AM - 6:30 PM",
  location: "Accelerator Centre",
  description: "Build for a cause.",
  registrationUrl: "https://example.com/register",
};

describe("submission contracts", () => {
  it("recognizes only supported review statuses", () => {
    expect(isSubmissionStatus("pending")).toBe(true);
    expect(isSubmissionStatus("approved")).toBe(true);
    expect(isSubmissionStatus("rejected")).toBe(true);
    expect(isSubmissionStatus("published")).toBe(false);
  });

  it("normalizes event fields and validates registration URLs", () => {
    expect(normaliseEventSubmissionFields({
      ...event,
      title: "  Canvas Designathon  ",
    }).title).toBe("Canvas Designathon");
    expect(() => normaliseEventSubmissionFields({
      ...event,
      registrationUrl: "javascript:alert(1)",
    })).toThrow("Registration link must be a valid HTTP or HTTPS URL");
  });

  it("rejects malformed database event records", () => {
    expect(() => parseEventSubmissionFields({ title: "Missing details" })).toThrow(
      "submission event.hosts must be a string",
    );
  });

  it("parses exact edit and review update variants", () => {
    expect(parseSubmissionUpdate({ type: "review", version: 3, status: "approved" })).toEqual({
      type: "review",
      version: 3,
      status: "approved",
    });

    const update = parseSubmissionUpdate({
      type: "edit",
      version: 2,
      event,
      post: DEFAULT_POST,
      badgeColor: " #B9F543 ",
    });
    expect(update.type).toBe("edit");
    if (update.type === "edit") {
      expect(update.badgeColor).toBe("#b9f543");
      expect(update.post.title).toBe("CANVAS\nDESIGNATHON");
    }
  });

  it("rejects mixed, unknown, and malformed update payloads", () => {
    expect(() => parseSubmissionUpdate({
      type: "review",
      version: 1,
      status: "approved",
      event,
    })).toThrow("submission update.event is not allowed");
    expect(() => parseSubmissionUpdate({ type: "delete", version: 1 })).toThrow(
      "Choose a valid submission update type",
    );
    expect(() => parseSubmissionUpdate({
      type: "edit",
      version: 1,
      event,
      post: DEFAULT_POST,
      badgeColor: "lime",
    })).toThrow("Badge color must be a six-digit hex color");
    expect(() => parseSubmissionUpdate({
      type: "edit",
      version: 1,
      event: { ...event, extra: true },
      post: DEFAULT_POST,
      badgeColor: "#b9f543",
    })).toThrow("event.extra is not allowed");
    expect(() => parseSubmissionUpdate({
      type: "review",
      version: 0,
      status: "approved",
    })).toThrow("submission update.version must be positive");
  });

  it("validates a bounded raster upload intent", () => {
    expect(parseSubmissionUploadIntent({
      fileName: " commons-photo.png ",
      fileSize: 1024,
      mimeType: "image/png",
    })).toEqual({
      fileName: "commons-photo.png",
      fileSize: 1024,
      mimeType: "image/png",
    });

    expect(() => parseSubmissionUploadIntent({
      fileName: "animation.gif",
      fileSize: 1024,
      mimeType: "image/gif",
    })).toThrow("Upload a PNG, JPEG, or WebP image");
    expect(() => parseSubmissionUploadIntent({
      fileName: "large.png",
      fileSize: MAX_COVER_IMAGE_SIZE_BYTES + 1,
      mimeType: "image/png",
    })).toThrow("10 MB or smaller");
    expect(() => parseSubmissionUploadIntent({
      fileName: "bad\nname.png",
      fileSize: 1024,
      mimeType: "image/png",
    })).toThrow("valid file name");
  });

  it("parses the one-time finalize contract and normalizes its identity fields", () => {
    const submission = parseSubmissionFinalize({
      submissionId: "B0483B56-5FD4-4FBD-A163-FA32D1C31A2B",
      uploadId: "cc680344-8f95-476b-80f9-65bf2b171d5b",
      finalizeToken: "a".repeat(43),
      submitterEmail: " EVENT@Example.com ",
      event,
    });

    expect(submission.submissionId).toBe("b0483b56-5fd4-4fbd-a163-fa32d1c31a2b");
    expect(submission.submitterEmail).toBe("event@example.com");
    expect(() => parseSubmissionFinalize({
      ...submission,
      finalizeToken: "short",
    })).toThrow("upload confirmation is invalid");
    expect(() => parseSubmissionFinalize({
      ...submission,
      submitterEmail: "not-an-email",
    })).toThrow("valid contact email");
  });

  it("parses stable cursor pagination with bounded page sizes", () => {
    const cursor = createSubmissionCursor({
      id: "00000000-0000-0000-0000-000000000001",
      submittedAt: "2026-07-15T05:00:00.000Z",
    });
    expect(parseSubmissionListQuery(new URLSearchParams({
      status: "approved",
      limit: "12",
      cursor,
    }))).toEqual({
      status: "approved",
      limit: 12,
      cursor: {
        id: "00000000-0000-0000-0000-000000000001",
        submittedAt: "2026-07-15T05:00:00.000Z",
      },
    });
    expect(() => parseSubmissionListQuery(new URLSearchParams({ limit: "51" }))).toThrow(
      "between 1 and 50",
    );
  });
});
