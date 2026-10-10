import assert from "node:assert/strict";
import test from "node:test";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";

import {
  buildAssetKey,
  buildCaptureScreenshotOptions,
  buildCaptureUrl,
  buildCaptureViewport,
  handler,
  parsePreviewMessage,
  parseScheduledCheck,
  resolveTargetRevision,
} from "./handler.mjs";

test("only the scheduled stale-preview check can enqueue previews", () => {
  parseScheduledCheck({ source: "aws.events", "detail-type": "Scheduled Event" });
  for (const event of [
    { source: "aws.events" },
    {},
    { action: "scrape-completed", run_id: "123" },
  ]) {
    assert.throws(() => parseScheduledCheck(event), /Unsupported/);
  }
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

test("the scheduled check queues every school with a stale preview", async (t) => {
  process.env.RUNTIME_SECRET_ARN = "test-secret";
  process.env.QUEUE_URL = "https://example.com/queue";
  t.mock.method(SecretsManagerClient.prototype, "send", async () => ({
    SecretString: JSON.stringify({
      SUPABASE_URL: "https://db.example",
      SUPABASE_SECRET_KEY: "test",
    }),
  }));
  const batches = [];
  t.mock.method(SQSClient.prototype, "send", async (command) => {
    batches.push(
      command.input.Entries.map((entry) => JSON.parse(entry.MessageBody)),
    );
    return {};
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url);
    assert.ok(parsed.pathname.endsWith("/schools"), `Unexpected request: ${url}`);
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      slug: `school-${index + 1}`,
      social_preview_revision: 9,
      social_preview_rendered_revision: index === 2 ? 9 : 8,
    }));
    return new Response(JSON.stringify(rows));
  });
  const scheduled = { source: "aws.events", "detail-type": "Scheduled Event" };
  assert.deepEqual(await handler(scheduled), { queued: 11 });
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [10, 1],
  );
  assert.deepEqual(batches[0][0], { school_id: 1, slug: "school-1", revision: 9 });
  assert.ok(batches.flat().every((message) => message.school_id !== 3));
  await assert.rejects(
    handler({ action: "scrape-completed", run_id: "456" }),
    /Unsupported/,
  );
  t.mock.method(SQSClient.prototype, "send", async () => ({
    Failed: [{ Id: "0" }],
  }));
  await assert.rejects(handler(scheduled), /Failed to enqueue/);
});
