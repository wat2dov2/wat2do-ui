import OpenAI from "openai";

// ============================================
// 🔑 INSERT YOUR OPENAI API KEY BELOW
// ============================================
const OPENAI_API_KEY: string = "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";
// ============================================

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true, // Only for local development!
});

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  priceRange: { min: string; max: string };
  dateRange: string;
  addedSince: string;
  requiresRegistration: boolean;
}

const SYSTEM_PROMPT = `You are a filter generator for a university events app. Given a natural language description, generate a JSON filter object.

Available options:
- Categories: "Academic", "Social & Games", "Cultural", "Religious", "Sports & Fitness", "Technology", "Arts & Crafts", "Music & Performance", "Health & Wellness", "Entrepreneurship"
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"
- Days (day of week): "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "searchQuery": "",
  "categories": [],
  "locations": [],
  "foods": [],
  "days": [],
  "priceRange": { "min": "", "max": "" },
  "dateRange": "",
  "addedSince": "",
  "requiresRegistration": false
}

IMPORTANT RULES:
- days: Use day of week names. "weekend" = ["Saturday", "Sunday"]. "weekday" = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]. "friday" = ["Friday"], etc.
- dateRange: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-25T00:00:00.000Z". Leave empty "" if not specified.
- addedSince: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-07T00:00:00.000Z". Leave empty "" if not specified.
- priceRange: Free events = {"min": "0", "max": "0"}. Under $10 = {"min": "", "max": "10"}.
- requiresRegistration: Set true only if user explicitly wants events requiring registration.
- Only use values from the available options above.
- Return raw JSON only, no markdown code blocks.

Today's date is ${new Date().toISOString()}.

Examples:
- "free tech events on weekends with pizza" → categories: ["Technology"], days: ["Saturday", "Sunday"], foods: ["Pizza"], priceRange: {"min": "0", "max": "0"}
- "friday social events at SLC" → categories: ["Social & Games"], days: ["Friday"], locations: ["SLC"]
- "events on December 25th" → dateRange: "2024-12-25T00:00:00.000Z"
- "events added in the last 3 days" → addedSince: calculate 3 days before today in ISO format`;

function validateAndSanitizeFilters(parsed: unknown): FilterState {
  // Default empty filter state
  const defaultFilters: FilterState = {
    searchQuery: "",
    categories: [],
    locations: [],
    foods: [],
    days: [],
    priceRange: { min: "", max: "" },
    dateRange: "",
    addedSince: "",
    requiresRegistration: false,
  };

  if (!parsed || typeof parsed !== "object") {
    return defaultFilters;
  }

  const obj = parsed as Record<string, unknown>;

  return {
    searchQuery: typeof obj.searchQuery === "string" ? obj.searchQuery : "",
    categories: Array.isArray(obj.categories) ? obj.categories.filter((c): c is string => typeof c === "string") : [],
    locations: Array.isArray(obj.locations) ? obj.locations.filter((l): l is string => typeof l === "string") : [],
    foods: Array.isArray(obj.foods) ? obj.foods.filter((f): f is string => typeof f === "string") : [],
    days: Array.isArray(obj.days) ? obj.days.filter((d): d is string => typeof d === "string") : [],
    priceRange: {
      min: typeof obj.priceRange === "object" && obj.priceRange && typeof (obj.priceRange as Record<string, unknown>).min === "string"
        ? (obj.priceRange as Record<string, unknown>).min as string : "",
      max: typeof obj.priceRange === "object" && obj.priceRange && typeof (obj.priceRange as Record<string, unknown>).max === "string"
        ? (obj.priceRange as Record<string, unknown>).max as string : "",
    },
    dateRange: typeof obj.dateRange === "string" ? obj.dateRange : "",
    addedSince: typeof obj.addedSince === "string" ? obj.addedSince : "",
    requiresRegistration: typeof obj.requiresRegistration === "boolean" ? obj.requiresRegistration : false,
  };
}

export async function generateFiltersWithAI(
  prompt: string,
  onChunk: (partialJson: string) => void
): Promise<FilterState> {
  let stream;

  try {
    stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
      stream: true,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        throw new Error("Invalid API key. Please check your OpenAI API key.");
      }
      if (error.message.includes("rate limit")) {
        throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      }
      throw new Error(`API error: ${error.message}`);
    }
    throw new Error("Failed to connect to OpenAI API");
  }

  let fullContent = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      fullContent += delta;
      onChunk(fullContent);
    }
  } catch (error) {
    throw new Error("Stream interrupted. Please try again.");
  }

  if (!fullContent.trim()) {
    throw new Error("Empty response from AI. Please try a different prompt.");
  }

  // Try to parse JSON, handling potential markdown code blocks
  let jsonString = fullContent.trim();

  // Remove markdown code blocks if present
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.slice(7);
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.slice(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.slice(0, -3);
  }
  jsonString = jsonString.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("AI returned invalid JSON. Please try again.");
  }

  // Validate and sanitize the parsed response
  return validateAndSanitizeFilters(parsed);
}

export function isApiKeyConfigured(): boolean {
  return OPENAI_API_KEY !== "YOUR_OPENAI_API_KEY_HERE" && OPENAI_API_KEY.length > 0;
}

// ============================================
// Event Generation with AI
// ============================================

export interface EventFormData {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: string;
  price: number;
  food: string[];
  requiresRegistration: boolean;
  organization: string;
}

const EVENT_SYSTEM_PROMPT = `You are an event generator for a university events app. Given a natural language description, generate a JSON event object.

Available options:
- Categories: "Academic", "Social & Games", "Cultural", "Religious", "Sports & Fitness", "Technology", "Arts & Crafts", "Music & Performance", "Health & Wellness", "Entrepreneurship", "Events", "Clubs", "Career"
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "title": "",
  "description": "",
  "date": "",
  "time": "",
  "location": "",
  "category": "",
  "price": 0,
  "food": [],
  "requiresRegistration": false,
  "organization": ""
}

IMPORTANT RULES:
- title: Create a catchy, descriptive event title
- description: Write 1-2 sentences describing the event
- date: Use format "YYYY-MM-DD". If no date specified, use a reasonable upcoming date.
- time: Use 24-hour format "HH:MM" (e.g., "14:00" for 2 PM, "18:30" for 6:30 PM)
- location: Use one of the available locations above
- category: Use one of the available categories above
- price: Number (0 for free events)
- food: Array of food items from the available options, empty array [] if none
- requiresRegistration: true/false
- organization: Create a reasonable club/organization name if not specified
- Return raw JSON only, no markdown code blocks.

Today's date is ${new Date().toISOString().split('T')[0]}.

Examples:
- "tech talk about AI next friday at 2pm" → title: "Tech Talk: The Future of AI", date: next friday's date, time: "14:00", category: "Technology"
- "free pizza social at SLC" → title: "Pizza Social Mixer", location: "SLC", price: 0, food: ["Pizza"], category: "Social & Games"
- "hackathon this weekend with registration" → title: "Weekend Hackathon", requiresRegistration: true, category: "Technology"`;

function validateAndSanitizeEvent(parsed: unknown): EventFormData {
  const defaultEvent: EventFormData = {
    title: "",
    description: "",
    date: new Date().toISOString().split('T')[0],
    time: "12:00",
    location: "",
    category: "",
    price: 0,
    food: [],
    requiresRegistration: false,
    organization: "",
  };

  if (!parsed || typeof parsed !== "object") {
    return defaultEvent;
  }

  const obj = parsed as Record<string, unknown>;

  return {
    title: typeof obj.title === "string" ? obj.title : "",
    description: typeof obj.description === "string" ? obj.description : "",
    date: typeof obj.date === "string" ? obj.date : defaultEvent.date,
    time: typeof obj.time === "string" ? obj.time : defaultEvent.time,
    location: typeof obj.location === "string" ? obj.location : "",
    category: typeof obj.category === "string" ? obj.category : "",
    price: typeof obj.price === "number" ? obj.price : 0,
    food: Array.isArray(obj.food) ? obj.food.filter((f): f is string => typeof f === "string") : [],
    requiresRegistration: typeof obj.requiresRegistration === "boolean" ? obj.requiresRegistration : false,
    organization: typeof obj.organization === "string" ? obj.organization : "",
  };
}

export async function generateEventWithAI(
  prompt: string,
  onChunk: (partialJson: string) => void
): Promise<EventFormData> {
  let stream;

  try {
    stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EVENT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        throw new Error("Invalid API key. Please check your OpenAI API key.");
      }
      if (error.message.includes("rate limit")) {
        throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      }
      throw new Error(`API error: ${error.message}`);
    }
    throw new Error("Failed to connect to OpenAI API");
  }

  let fullContent = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      fullContent += delta;
      onChunk(fullContent);
    }
  } catch (error) {
    throw new Error("Stream interrupted. Please try again.");
  }

  if (!fullContent.trim()) {
    throw new Error("Empty response from AI. Please try a different prompt.");
  }

  // Try to parse JSON, handling potential markdown code blocks
  let jsonString = fullContent.trim();

  // Remove markdown code blocks if present
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.slice(7);
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.slice(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.slice(0, -3);
  }
  jsonString = jsonString.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("AI returned invalid JSON. Please try again.");
  }

  return validateAndSanitizeEvent(parsed);
}
