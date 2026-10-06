import { timingSafeEqual } from "node:crypto";
import { SPECTATOR_WORDS } from "./words";
/** 256 secret bits; the separately random locator grants no access. */
export function randomHex(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const WORD_COUNT = 5;
/** Links issued before the switch to 5 words stay valid until they expire. */
const LEGACY_WORD_COUNT = 13;
const WORD_INDEX = new Map(SPECTATOR_WORDS.map((word, i) => [word, i]));
/**
 * 5 words from a 1024-word list: 50 secret bits that are easy to type. Below
 * the 128-bit floor by explicit owner decision; spectators can only view.
 */
export function randomWords(count = WORD_COUNT): string {
  // 1024 = 2^10, so masking a uniform 16-bit value is unbiased.
  return Array.from(
    crypto.getRandomValues(new Uint16Array(count)),
    (n) => SPECTATOR_WORDS[n & 1023],
  ).join("-");
}
/**
 * Word capabilities carry no separate locator; it is derived one-way from the
 * secret (domain-separated from the stored hash) so the link stays short.
 */
export async function wordLocator(secret: string): Promise<string> {
  return (await hashSecret(`bierrad-locator:${secret}`)).slice(0, 32);
}
export function parseCapability(
  value: string | null,
): { locator: string | null; secret: string } | null {
  if (!value || value.length > 128) return null;
  if (/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) {
    const [locator, secret] = value.split(".");
    return { locator, secret };
  }
  const words = value.split("-");
  return (words.length === WORD_COUNT || words.length === LEGACY_WORD_COUNT) &&
    words.every((w) => WORD_INDEX.has(w))
    ? { locator: null, secret: value }
    : null;
}
export async function capabilityLocator(capability: {
  locator: string | null;
  secret: string;
}): Promise<string> {
  return capability.locator ?? (await wordLocator(capability.secret));
}
export async function hashSecret(secret: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function equalHash(a: string, b: string): boolean {
  return (
    a.length === b.length &&
    timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b))
  );
}
/**
 * Stable per-channel pseudonym of a Slack user: HMAC-SHA256 with a random key
 * of that binding, so stored values cannot be linked to an identity once the
 * key is gone.
 */
export async function pseudonym(keyHex: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyHex.match(/../g)!, (h) => parseInt(h, 16)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`koffierad-member:${userId}`),
  );
  return Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
