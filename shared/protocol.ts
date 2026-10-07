import type { ReviewProgress } from "./reviews";
import type { WheelVariant } from "./variant";
import type {
  DrawInstruction,
  DrawState,
  Participant,
  ClientRole,
} from "../src/domain/models";
export interface ScheduledDraw {
  startAt: string;
  status: "pending" | "refreshing" | "skipped";
}
export interface SlackHostStatus {
  enabled: boolean;
  source: "manual" | "slack";
  importing: boolean;
  count?: number;
  syncedAt?: string;
  result?: {
    drawId: string;
    status: "pending" | "posting" | "posted" | "failed" | "uncertain";
    retryAt?: number;
  };
  /** Spectator-link reminder in the Slack thread before a scheduled draw. */
  reminder?: {
    startAt: string;
    status: SlackReminderStatus;
  };
  /** Reviews of the winners after each draw (login-started sessions only). */
  reviews?: { enabled: boolean; minutes: number };
}
export type SlackReminderStatus =
  | "pending"
  | "posting"
  | "posted"
  | "failed"
  | "uncertain"
  | "skipped";
/** Explicit DTO; never serialize backend storage directly. */
export interface PublicBeerWheelSession {
  variant?: WheelVariant;
  /** Koekrad rounds only: the validated word from `/koekrad <titel>`. */
  title?: string;
  participants: readonly Participant[];
  winnerCount: number;
  state: DrawState;
  winnerIds: readonly string[];
  activeDraw?: DrawInstruction;
  expiresAt: string;
  revision: number;
  slack?: SlackHostStatus;
  scheduledDraw?: ScheduledDraw;
  /** Counts only, while a channel round can be reviewed. */
  review?: ReviewProgress;
}
export type HostCommand =
  | { type: "setParticipants"; names: string[] }
  | { type: "setWinnerCount"; count: number }
  | { type: "startDraw" }
  | {
      type: "setScheduledDraw";
      startAt: string | null;
      /** Opt-in: the host's own spectator link, posted to the Slack thread. */
      spectatorCapability?: string;
    }
  | { type: "reset" }
  | { type: "endSession" }
  | { type: "slackImport"; permalink?: string }
  | { type: "slackManual" }
  | { type: "slackRetry" }
  | { type: "setReviews"; enabled: boolean; minutes: number };
export type ClientToServerMessage = { type: "ping" };
export type ServerToClientMessage =
  | {
      type: "snapshot";
      session: PublicBeerWheelSession;
      role: ClientRole;
      serverNow: number;
    }
  | { type: "pong"; serverNow: number }
  | { type: "unavailable" }
  | { type: "error"; code: "forbidden" | "invalid" | "rate_limited" };
export interface CreatedSession {
  hostCapability: string;
  spectatorCapability: string;
  expiresAt: string;
}
