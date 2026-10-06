/** Public contract for channel-bound Koffierad wheels. No secrets or Slack IDs. */
import type { WheelVariant } from "./variant";
import type { ReviewBallot, ReviewSettings } from "./reviews";
/** What a channel round fetches; one binding serves both. */
export type ChannelVariant = Extract<WheelVariant, "coffee" | "water">;
export const channelVariants: readonly ChannelVariant[] = ["coffee", "water"];
export function isChannelVariant(value: unknown): value is ChannelVariant {
  return (channelVariants as readonly unknown[]).includes(value);
}
/** Fixed channel copy per variant; display only, never authorizes. */
export const channelCopy: Record<
  ChannelVariant,
  { command: string; round: string; rounds: string; tap: string }
> = {
  coffee: {
    command: "/koffierad",
    round: "koffieronde",
    rounds: "koffierondes",
    tap: "zetten",
  },
  water: {
    command: "/waterrad",
    round: "waterronde",
    rounds: "waterrondes",
    tap: "tappen",
  },
};
export const DEFAULT_ROUND_MINUTES = 5;
export const MAX_ROUND_MINUTES = 30;
/** Rounds per channel per rolling 24 hours. */
export const MAX_ROUNDS_PER_DAY = 25;
/** A binding is removed after this long without a bind or round request. */
export const CHANNEL_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The latest round while it can still be watched; `active` until its draw is
 * over, after which a new round may be requested.
 */
export interface ChannelRound {
  /** Absent on rounds from before water; those are coffee. */
  variant?: ChannelVariant;
  startAt: string;
  spectatorCapability: string;
  active: boolean;
  /** Whether this round's winner can be reviewed. */
  reviews?: boolean;
}
export interface ChannelStatus {
  /** `member`: a personal link from Sign in with Slack; requests rounds and reviews. */
  role: "admin" | "requester" | "member";
  /** The theme to show: the latest round's, coffee before any round. */
  variant?: ChannelVariant;
  defaultMinutes: number;
  round?: ChannelRound;
  roundsLeft: number;
  expiresAt: string;
  /** View-only word link of the channel, easy to type on another screen. */
  viewerCapability?: string;
  /** Channel name from the last signed `/koffierad` or `/waterrad`, without `#`; display only. */
  channelName?: string;
  reviews?: ReviewSettings;
  /** Personal links only: about this person, never about anyone else. */
  member?: {
    participating?: boolean;
    ballot?: ReviewBallot;
  };
}
/** Rounds start only from a signed `/koffierad` or `/waterrad`, never with a link. */
export type ChannelCommand =
  | { type: "setDefaultMinutes"; minutes: number }
  | { type: "setReviews"; enabled: boolean; minutes: number }
  | { type: "review"; drawId: string; scores: number[]; texts: string[] }
  | { type: "logout" }
  | { type: "rotateRequestLink" }
  | { type: "unbind" };
export type ChannelCommandResult =
  | { type: "status"; status: ChannelStatus }
  | { type: "rotated"; requestCapability: string; status: ChannelStatus }
  | { type: "unbound" }
  | { type: "loggedOut" }
  /** All a view-only word link gets: the latest round, no commands. */
  | {
      type: "view";
      variant?: ChannelVariant;
      channelName?: string;
      round?: ChannelRound;
    };

export function validRoundMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_ROUND_MINUTES
  );
}
/**
 * A round starts on a whole minute, at least `minutes` from now, so the shown
 * clock time (HH:mm) is exactly when the wheel turns.
 */
export function roundStartAt(now: number, minutes: number): number {
  return Math.ceil((now + minutes * 60000) / 60000) * 60000;
}
/**
 * Accepts a Slack channel or message link, or a bare public/private channel ID.
 * Only the ID is used; the link itself is never fetched.
 */
export function parseChannelInput(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 1024) return null;
  if (/^[CG][A-Z0-9]{8,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9][a-z0-9-]*\.slack\.com$/.test(url.hostname)
    )
      return null;
    const match = /^\/(?:archives|client\/T[A-Z0-9]{8,20})\/([CG][A-Z0-9]{8,20})(?:\/|$)/.exec(
      url.pathname,
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
