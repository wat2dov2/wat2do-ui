import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import chromium from "@sparticuz/chromium";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const controlPath = process.env.SOCIAL_PREVIEW_CONTROL_PATH
  ? process.env.SOCIAL_PREVIEW_CONTROL_PATH
  : new URL("../backend/controlbox/social_previews.json", import.meta.url);
const controls = JSON.parse(readFileSync(controlPath, "utf8"));

const REGION = process.env.AWS_REGION ?? "ca-central-1";
const s3 = new S3Client({ region: REGION });
const secretsManager = new SecretsManagerClient({ region: REGION });
const sqs = new SQSClient({ region: REGION });

let runtimeSecret;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function getRuntimeSecret() {
  if (runtimeSecret) return runtimeSecret;

  const response = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: requiredEnvironment("RUNTIME_SECRET_ARN"),
    }),
  );
  const payload = JSON.parse(response.SecretString ?? "{}");
  const url = String(payload.SUPABASE_URL ?? "").replace(/\/$/, "");
  const secretKey = String(payload.SUPABASE_SECRET_KEY ?? "");
  if (!url || !secretKey) {
    throw new Error(
      "Runtime secret must contain SUPABASE_URL and SUPABASE_SECRET_KEY",
    );
  }
  runtimeSecret = {
    url,
    secretKey,
    eventFeedRevalidationSecret: String(
      payload.EVENT_FEED_REVALIDATION_SECRET ?? "",
    ),
  };
  return runtimeSecret;
}

async function supabaseRequest(path, init = {}) {
  const { url, secretKey } = await getRuntimeSecret();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Supabase ${init.method ?? "GET"} ${path} failed: ${response.status}`,
    );
  }
  if (response.status === 204) return null;
  return response.json();
}

export function isSchedulerEvent(event) {
  return event?.source === "aws.events";
}

export function shouldAdvanceScheduledRevision(school) {
  return (
    Number(school.social_preview_revision) <=
    Number(school.social_preview_rendered_revision)
  );
}

export function resolveTargetRevision(school, queuedRevision) {
  const revision = Number(school.social_preview_revision);
  if (!Number.isSafeInteger(revision) || revision < queuedRevision) {
    throw new Error("School has an invalid social-preview revision");
  }
  return revision;
}

export function parsePreviewMessage(body) {
  const message = JSON.parse(body);
  const schoolId = Number(message.school_id);
  const revision = Number(message.revision);
  const slug = String(message.slug ?? "");
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    throw new Error("Social-preview message has an invalid school_id");
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("Social-preview message has an invalid revision");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Social-preview message has an invalid slug");
  }
  return { schoolId, revision, slug };
}

export function buildAssetKey(slug, revision, renderedAt) {
  const timestamp = renderedAt.toISOString().replace(/[:.]/g, "-");
  return `media/social-previews/${slug}/r${revision}-${timestamp}.jpg`;
}

export function buildCaptureViewport() {
  return {
    width: controls.viewport_width,
    height: controls.viewport_height,
    deviceScaleFactor: controls.device_scale_factor,
  };
}

export function buildCaptureUrl(slug, domainName) {
  return `https://${slug}.${domainName}${controls.capture_path}`;
}

async function markSchoolDirty(schoolId) {
  const revision = await supabaseRequest("rpc/mark_school_social_preview_dirty", {
    method: "POST",
    body: JSON.stringify({ p_school_id: schoolId }),
  });
  const parsed = Number(revision);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Failed to advance social-preview revision for school ${schoolId}`,
    );
  }
  return parsed;
}

async function enqueueSchoolPreviews() {
  const schools = await supabaseRequest(
    "schools?select=id,slug,social_preview_revision,social_preview_rendered_revision&order=id",
  );
  const messages = [];
  for (const school of schools ?? []) {
    let revision = Number(school.social_preview_revision);
    if (shouldAdvanceScheduledRevision(school)) {
      revision = await markSchoolDirty(Number(school.id));
    }
    messages.push({
      school_id: Number(school.id),
      slug: String(school.slug),
      revision,
    });
  }

  const queueUrl = requiredEnvironment("QUEUE_URL");
  for (let offset = 0; offset < messages.length; offset += 10) {
    const batch = messages.slice(offset, offset + 10);
    const result = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((message, index) => ({
          Id: `${offset + index}`,
          MessageBody: JSON.stringify(message),
        })),
      }),
    );
    if (result.Failed?.length) {
      throw new Error(
        `Failed to enqueue ${result.Failed.length} social-preview jobs`,
      );
    }
  }

  console.info(JSON.stringify({ action: "enqueue", queued: messages.length }));
  return { queued: messages.length };
}

async function getSchoolState(schoolId) {
  const rows = await supabaseRequest(
    `schools?select=id,slug,social_preview_revision,social_preview_rendered_revision&id=eq.${schoolId}&limit=1`,
  );
  return rows?.[0] ?? null;
}

async function captureSchoolPage(slug) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: buildCaptureViewport(),
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    const response = await page.goto(
      buildCaptureUrl(slug, requiredEnvironment("DOMAIN_NAME")),
      {
        waitUntil: "networkidle2",
        timeout: controls.navigation_timeout_seconds * 1000,
      },
    );
    if (!response?.ok()) {
      throw new Error(
        `School event feed returned ${response?.status() ?? "no response"}`,
      );
    }

    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important}",
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const pendingImages = Array.from(document.images)
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
        );
      await Promise.race([
        Promise.all(pendingImages),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      window.scrollTo(0, 0);
    });

    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: controls.jpeg_quality,
      fullPage: false,
      captureBeyondViewport: false,
    });
    return screenshot;
  } finally {
    await browser.close();
  }
}

async function revalidateSchoolMetadata(slug) {
  const { eventFeedRevalidationSecret } = await getRuntimeSecret();
  if (!eventFeedRevalidationSecret) {
    console.warn(
      "EVENT_FEED_REVALIDATION_SECRET is unavailable; metadata cache was not invalidated",
    );
    return;
  }
  try {
    const domainName = requiredEnvironment("DOMAIN_NAME");
    const response = await fetch(`https://${domainName}/api/revalidate-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${eventFeedRevalidationSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ school: slug }),
    });
    if (!response.ok) {
      throw new Error(`revalidation returned ${response.status}`);
    }
  } catch (error) {
    console.warn(
      `Social-preview metadata revalidation failed for ${slug}`,
      error,
    );
  }
}

async function renderSchoolPreview(message) {
  const school = await getSchoolState(message.schoolId);
  if (!school || school.slug !== message.slug) {
    throw new Error(
      `School ${message.schoolId} does not match queued slug ${message.slug}`,
    );
  }
  const targetRevision = resolveTargetRevision(school, message.revision);
  if (Number(school.social_preview_rendered_revision) >= targetRevision) {
    return { skipped: true };
  }

  const screenshot = await captureSchoolPage(message.slug);
  const renderedAt = new Date();
  const key = buildAssetKey(message.slug, targetRevision, renderedAt);
  await s3.send(
    new PutObjectCommand({
      Bucket: requiredEnvironment("ASSETS_BUCKET_NAME"),
      Key: key,
      Body: screenshot,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const publicBaseUrl = requiredEnvironment("ASSETS_PUBLIC_BASE_URL").replace(
    /\/$/,
    "",
  );
  const imageUrl = `${publicBaseUrl}/${key.replace(/^media\//, "")}`;
  const rows = await supabaseRequest(
    `schools?id=eq.${message.schoolId}&social_preview_revision=eq.${targetRevision}&social_preview_rendered_revision=lt.${targetRevision}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        social_preview_image_url: imageUrl,
        social_preview_rendered_revision: targetRevision,
        social_preview_rendered_at: renderedAt.toISOString(),
      }),
    },
  );

  const published = Boolean(rows?.length);
  if (published) await revalidateSchoolMetadata(message.slug);
  console.info(
    JSON.stringify({
      action: "render",
      school: message.slug,
      revision: targetRevision,
      published,
    }),
  );
  return { imageUrl, published };
}

async function processQueue(event) {
  const failures = [];
  for (const record of event.Records ?? []) {
    try {
      await renderSchoolPreview(parsePreviewMessage(record.body));
    } catch (error) {
      console.error("Social-preview render failed", error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

export async function handler(event) {
  if (isSchedulerEvent(event)) return enqueueSchoolPreviews();
  if (Array.isArray(event?.Records)) return processQueue(event);
  throw new Error("Unsupported social-preview Lambda event");
}
