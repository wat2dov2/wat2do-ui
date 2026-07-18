export type JsonObject = Record<string, unknown>;

export function readJsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

export function assertExactJsonKeys(
  value: JsonObject,
  expectedKeys: readonly string[],
  label: string,
) {
  const unexpectedKey = Object.keys(value).find((key) => !expectedKeys.includes(key));
  if (unexpectedKey) {
    throw new Error(`${label}.${unexpectedKey} is not allowed.`);
  }

  const missingKey = expectedKeys.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missingKey) {
    throw new Error(`${label}.${missingKey} is required.`);
  }
}

export function readJsonString(value: JsonObject, key: string, label: string) {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`${label}.${key} must be a string.`);
  }
  return field;
}

export function readJsonStringArray(value: JsonObject, key: string, label: string) {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`${label}.${key} must be an array of strings.`);
  }
  return field;
}
