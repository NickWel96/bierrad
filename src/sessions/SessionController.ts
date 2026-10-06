import type {
  BeerWheelSession,
  Participant,
  SessionCapabilities,
} from "../domain/models";
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unavailable";
export interface LiveInfo {
  role: import("../domain/models").ClientRole;
  status: ConnectionStatus;
  expiresAt?: string;
  slack?: import("../../shared/protocol").SlackHostStatus;
  scheduledDraw?: import("../../shared/protocol").ScheduledDraw;
  /** Counts only, while the round can be reviewed. */
  review?: import("../../shared/reviews").ReviewProgress;
}
export interface SessionSnapshot {
  readonly session: BeerWheelSession;
  readonly capabilities: SessionCapabilities;
  readonly notice: string;
  readonly clockOffsetMs?: number;
  readonly live?: LiveInfo;
}
/** Stable immutable snapshots. Remote implementations publish server snapshots. */
export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  setParticipants(participants: readonly Participant[]): Promise<void>;
  restoreParticipants(): Promise<void>;
  setWinnerCount(count: number): Promise<void>;
  /** Remote sessions ignore the rig: the server alone picks winners. */
  startDraw(rig?: import("../utils/random").DrawRig): Promise<void>;
  reset(): Promise<void>;
  /** `shareSpectatorLink` posts the spectator link to the Slack thread before the start. */
  setScheduledDraw?(
    startAt: string | null,
    shareSpectatorLink?: boolean,
  ): Promise<void>;
  /** Host routes carrying the spectator link can share it via Slack. */
  readonly canShareSpectatorLink?: boolean;
  importSlack?(permalink?: string): Promise<void>;
  useManualSource?(): Promise<void>;
  retrySlackResult?(): Promise<void>;
  /** Login-started Slack sessions: reviews of the winners after each draw. */
  setReviews?(enabled: boolean, minutes: number): Promise<void>;
}
