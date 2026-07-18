import { NextResponse } from "next/server";
import { curatorAccessErrorResponse, verifyCuratorAccess } from "@/lib/curator-auth";
import {
  COMMONS_GENERATION_INSTRUCTIONS,
  COMMONS_POST_SCHEMA,
  MAX_RAW_EVENT_INFO_CHARACTERS,
} from "@/lib/prompt";
import { normalisePost, type CommonsPost } from "@/lib/post";
import {
  readJsonWithLimit,
  requireSameOrigin,
  SafeRequestError,
} from "@/lib/request-security";

export const runtime = "nodejs";

const REQUEST_MAX_BYTES = 72 * 1024;
const OPENAI_TIMEOUT_MS = 30_000;

interface GenerateRequest {
  rawEventInfo?: unknown;
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{ text?: string }>;
  }>;
}

function responseText(response: OpenAIResponse): string | null {
  if (response.output_text) return response.output_text;

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .find(Boolean) ?? null;
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
  } catch (error) {
    if (error instanceof SafeRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Request could not be verified." }, { status: 403 });
  }

  const access = await verifyCuratorAccess();
  if (!access.ok) return curatorAccessErrorResponse(access);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Commons generation is missing OPENAI_API_KEY.");
    return NextResponse.json(
      { error: "Generation is temporarily unavailable." },
      { status: 503 },
    );
  }

  let body: GenerateRequest;
  try {
    body = await readJsonWithLimit<GenerateRequest>(request, REQUEST_MAX_BYTES);
  } catch (error) {
    if (error instanceof SafeRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Request body could not be read." }, { status: 400 });
  }

  const rawEventInfo = typeof body.rawEventInfo === "string" ? body.rawEventInfo.trim() : "";

  if (!rawEventInfo) {
    return NextResponse.json({ error: "Paste event information before generating." }, { status: 400 });
  }
  if (rawEventInfo.length > MAX_RAW_EVENT_INFO_CHARACTERS) {
    return NextResponse.json({ error: "Event information is too long." }, { status: 413 });
  }

  let openAIResponse: Response;
  try {
    openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        instructions: COMMONS_GENERATION_INSTRUCTIONS,
        input: rawEventInfo,
        text: {
          format: {
            type: "json_schema",
            name: "waterloo_commons_post",
            strict: true,
            schema: COMMONS_POST_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    console.error(timedOut ? "OpenAI Commons generation timed out." : "OpenAI Commons generation request failed.");
    return NextResponse.json(
      { error: timedOut ? "Generation timed out. Please try again." : "Generation is temporarily unavailable." },
      { status: timedOut ? 504 : 502 },
    );
  }

  if (!openAIResponse.ok) {
    console.error(
      "OpenAI Commons generation failed.",
      openAIResponse.status,
      openAIResponse.headers.get("x-request-id") ?? "no-request-id",
    );
    return NextResponse.json({ error: "Generation failed. Please try again." }, { status: 502 });
  }

  let response: OpenAIResponse;
  try {
    response = (await openAIResponse.json()) as OpenAIResponse;
  } catch {
    return NextResponse.json({ error: "Generation returned unusable post data. Please try again." }, { status: 502 });
  }
  const output = responseText(response);
  if (!output) {
    return NextResponse.json({ error: "Generation returned no usable post data." }, { status: 502 });
  }

  try {
    return NextResponse.json({ post: normalisePost(JSON.parse(output) as CommonsPost) });
  } catch {
    return NextResponse.json({ error: "Generation returned unusable post data. Please try again." }, { status: 502 });
  }
}
