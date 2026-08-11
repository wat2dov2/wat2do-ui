import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssetKey,
  buildCaptureScreenshotOptions,
  buildCaptureUrl,
  buildCaptureViewport,
  isSchedulerEvent,
  parsePreviewMessage,
  resolveTargetRevision,
  shouldAdvanceScheduledRevision,
} from "./handler.mjs";

test("scheduler events are distinguished from SQS events", () => {
  assert.equal(isSchedulerEvent({ source: "aws.events" }), true);
  assert.equal(isSchedulerEvent({ Records: [] }), false);
});

test("each completed scheduled revision advances on the next cycle", () => {
  assert.equal(
    shouldAdvanceScheduledRevision({
      social_preview_revision: 7,
      social_preview_rendered_revision: 7,
    }),
    true,
  );
  assert.equal(
    shouldAdvanceScheduledRevision({
      social_preview_revision: 8,
      social_preview_rendered_revision: 7,
    }),
    false,
  );
});

test("a queued job renders the newest revision available when it starts", () => {
  assert.equal(resolveTargetRevision({ social_preview_revision: 9 }, 7), 9);
  assert.throws(
    () => resolveTargetRevision({ social_preview_revision: 6 }, 7),
    /invalid social-preview revision/,
  );
});

test("queue messages require a registered school slug and positive revision", () => {
  assert.deepEqual(
    parsePreviewMessage('{"school_id":1,"slug":"uwaterloo","revision":7}'),
    { schoolId: 1, slug: "uwaterloo", revision: 7 },
  );
  assert.throws(
    () => parsePreviewMessage('{"school_id":1,"slug":"../bad","revision":7}'),
    /invalid slug/,
  );
});

test("asset keys are immutable and school-scoped", () => {
  assert.equal(
    buildAssetKey("uwaterloo", 7, new Date("2026-08-03T20:00:00.000Z")),
    "media/social-previews/uwaterloo/r7-2026-08-03T20-00-00-000Z.jpg",
  );
});

test("capture targets the canonical school event feed at social-card size", () => {
  assert.equal(
    buildCaptureUrl("uwaterloo", "wat2do.io"),
    "https://uwaterloo.wat2do.io/",
  );
  assert.deepEqual(buildCaptureViewport(), {
    width: 2000,
    height: 1050,
    deviceScaleFactor: 1,
  });
  assert.deepEqual(buildCaptureScreenshotOptions(), {
    type: "jpeg",
    quality: 90,
    fullPage: false,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: 2000,
      height: 1050,
      scale: 0.6,
    },
  });
});
