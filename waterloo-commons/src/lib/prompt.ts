export const MAX_RAW_EVENT_INFO_CHARACTERS = 16_000;

export const COMMONS_GENERATION_INSTRUCTIONS = `You turn raw Waterloo event information into a finished Waterloo Commons social post.

Return a single object that follows the supplied schema exactly.

The poster fields must be concise and immediately usable:
- title: uppercase display title, with a newline only when it improves a two-line composition.
- hostOrg: the organiser's public-facing name.
- badge: one short uppercase category, normally EXPLORE, MAKE, WATCH, EAT, MOVE, or MEET.
- pills: 0 to 5 short uppercase tags, each 24 characters or fewer.
- venue, dateLine, timeLine: factual, compact, display-ready text. Date and time must not be invented.

Write the caption in exactly this format:
{TITLE} - hosted by {org}

🗓️ {date @ time}
📍 {venue}

{2-3 energetic sentences that only use supplied facts.}

RSVP + more events on wat2do.ca

Here is the style example to emulate:
Input: Animation Celebration, hosted by Waterloo Animation Society. Thursday July 24, 7 PM at The Q in SLC. A free screening of student-made short animations, with a creator Q&A.
Output fields: title ANIMATION\\nCELEBRATION; hostOrg Waterloo Animation Society; badge EXPLORE; pills [PAPRIKA SCREENING, FREE, STUDENT-MADE]; venue The Q, SLC; dateLine THU, JUL 24; timeLine 7:00 PM.

Never make up an RSVP link, performer, price, date, time, venue, or host. If a fact is unavailable, use TBA for the corresponding compact display field and keep it out of the caption.`;

export const COMMONS_POST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hostOrg", "badge", "pills", "venue", "dateLine", "timeLine", "caption"],
  properties: {
    title: { type: "string" },
    hostOrg: { type: "string" },
    badge: { type: "string" },
    pills: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    venue: { type: "string" },
    dateLine: { type: "string" },
    timeLine: { type: "string" },
    caption: { type: "string" },
  },
} as const;
