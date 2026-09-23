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
  parseCompletedRun,
  parsePreviewMessage,
  resolveTargetRevision,
} from "./handler.mjs";

test("only explicit completed scrape runs can enqueue previews", () => {
  assert.equal(
    parseCompletedRun({ action: "scrape-completed", run_id: "123" }),
    "123",
  );
  for (const event of [
    { source: "aws.events" },
    {},
    { action: "scrape-completed", run_id: "1&bad" },
  ]) {
    assert.throws(() => parseCompletedRun(event), /Unsupported/);
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

test("completed runs queue only changed, fully processed CacheEntID schools", async (t) => {
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
  const requests = [];
  let rolloverCompleted = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    requests.push(parsed);
    let rows;
    if (parsed.pathname.endsWith("/instagram_notifications")) {
      assert.equal(params.get("cache_ent_id"), "not.is.null");
      const run = params.get("instagram_notification_media.github_run_id");
      if (run === "eq.123") {
        rows =
          params.get("offset") === "0"
            ? Array.from({ length: 500 }, (_, id) => ({ id, school_id: 1 }))
            : [
                { id: 501, school_id: 2 },
                { id: 502, school_id: 3 },
                { id: 503, school_id: 4 },
              ];
      } else if (run === "eq.456") {
        rows = [{ id: 501, school_id: 2 }];
      } else {
        rows = [];
      }
    } else if (parsed.pathname.endsWith("/instagram_notification_media")) {
      assert.equal(params.get("status"), "in.(pending,processing)");
      assert.equal(
        params.get("instagram_notifications.cache_ent_id"),
        "not.is.null",
      );
      // School 2 still has work in a rollover run; school 4 has an active worker.
      rows =
        !rolloverCompleted &&
        ["eq.2", "eq.4"].includes(
          params.get("instagram_notifications.school_id"),
        )
          ? [{ id: "unfinished" }]
          : [];
    } else if (parsed.pathname.endsWith("/schools")) {
      const id = Number(params.get("id").slice(3));
      rows = [
        {
          id,
          slug: `school-${id}`,
          social_preview_revision: 9,
          social_preview_rendered_revision: id === 3 ? 9 : 8,
        },
      ];
    } else {
      assert.fail(`Unexpected request: ${url}`);
    }
    return new Response(JSON.stringify(rows));
  });
  assert.deepEqual(
    await handler({ action: "scrape-completed", run_id: "123" }),
    { queued: 1 },
  );
  assert.deepEqual(batches, [
    [{ school_id: 1, slug: "school-1", revision: 9 }],
  ]);
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/instagram_notifications"))
      .length,
    2,
  );
  rolloverCompleted = true;
  assert.deepEqual(
    await handler({ action: "scrape-completed", run_id: "456" }),
    { queued: 1 },
  );
  assert.deepEqual(batches[1], [
    { school_id: 2, slug: "school-2", revision: 9 },
  ]);
  assert.deepEqual(
    await handler({ action: "scrape-completed", run_id: "789" }),
    { queued: 0 },
  );
  assert.equal(
    batches.length,
    2,
    "ordinary or empty runs must not queue a preview",
  );
  t.mock.method(SQSClient.prototype, "send", async () => ({
    Failed: [{ Id: "0" }],
  }));
  await assert.rejects(
    handler({ action: "scrape-completed", run_id: "456" }),
    /Failed to enqueue/,
  );
});
