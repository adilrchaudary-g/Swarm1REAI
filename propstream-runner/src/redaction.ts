const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\+?1?[-.\s(]*\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}\b/g;
const MAILING_RE = /\b\d{1,6}\s+[A-Z0-9.'#\-\s]{3,},\s*[A-Z\s.'-]{2,},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/gi;

export function redactString(input: string): string {
  return input
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_RE, "[REDACTED_PHONE]")
    .replace(MAILING_RE, "[REDACTED_ADDRESS]");
}

export function redactValue<T>(input: T): T {
  if (typeof input === "string") {
    return redactString(input) as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactValue(item)) as T;
  }
  if (input && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (
        /phone|email|mailing|address|owner_name|contact/i.test(key) &&
        typeof value === "string"
      ) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = redactValue(value);
    }
    return result as T;
  }
  return input;
}
