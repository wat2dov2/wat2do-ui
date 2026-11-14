/**
 * Centralized external links used across the application.
 */
export const EXTERNAL_LINKS = {
  WHATSAPP_BOT: "https://wa.me/message/wat2do-bot-placeholder",
  SLEF_INFO: "https://wusa.ca/about/your-money/funding/",
  LINKEDIN: "https://www.linkedin.com/company/wat2do/",
} as const;

/** Every school has its own Wat2Do Instagram account, named after its subdomain. */
export function schoolInstagramHandle(school: string): string {
  return `wat2do.${school}`;
}
