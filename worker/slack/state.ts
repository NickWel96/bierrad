import { reactionVariant, themes } from "../../shared/variant";
import type { CallOutcome } from "../channel/messages";
import { createSession } from "../../src/domain/drawEngine";
import type { WheelVariant } from "../../shared/variant";
import type { SlackReminderStatus } from "../../shared/protocol";
import type { StoredSession } from "../session";
import { RequestError } from "../session";
import type { SlackPerson, SlackSource } from "./source";
import { SlackApiClient, SlackError } from "./api";
export type ChannelNotice = "empty" | "unreadable";
/** Updates of a channel round's own call; repeating one is harmless. */
export const MAX_CARD_ATTEMPTS = 3;
/**
 * A settled channel round rewrites its call message in place, so the channel
 * keeps one message per round. Only the bot's own call is ever updated.
 */
export type CallCard = CallOutcome & {
  startAt: number;
  status: "pending" | "updating" | "updated" | "failed";
  readyAt: number;
  attempts: number;
  attemptedAt?: number;
};
export interface SlackJob {
  drawId: string;
  source: SlackSource;
  names: string[];
  /** Private, frozen in winner order; absent on jobs created before mentions shipped. */
  mentionIds?: (string | null)[];
  status: "pending" | "posting" | "posted" | "failed" | "uncertain";
  readyAt: number;
  attemptedAt?: number;
  retryAt?: number;
  postedMessageTs?: string;
}
/** Posted this long before a scheduled start; shorter plans post right away. */
export const REMINDER_LEAD_MS = 120000;
/** No reminder when less than this remains before the start. */
export const REMINDER_MIN_LEAD_MS = 30000;
/** Bounds thread messages a host can trigger by rescheduling. */
export const MAX_REMINDER_POSTS = 5;
export interface SlackReminder {
  id: string;
  startAt: string;
  readyAt: number;
  /**
   * Raw spectator capability, verified against the stored hash. Kept only while
   * a post is still possible and deleted as soon as the reminder settles.
   */
  capability?: string;
  status: SlackReminderStatus;
  attempts: number;
  attemptedAt?: number;
  retryAt?: number;
}
export interface SlackState {
  grantHash: string;
  grantExpiresAt?: number;
  source?: SlackSource;
  mapping: Record<string, string>;
  syncedAt?: string;
  count?: number;
  importing?: { id: string; until: number };
  nextImportAt?: number;
  nextFinalImportAt?: number;
  retryImportAt?: number;
  job?: SlackJob;
  /** Channel rounds only: the pending rewrite of the call message. */
  card?: CallCard;
  reminder?: SlackReminder;
  reminderPosts?: number;
  /** Started by a channel-bound Koffierad: no host, refreshes itself until the draw. */
  channelRound?: boolean;
  /** Private: the bot's own user, whose prefilled reaction never counts. */
  excludeUserIds?: string[];
}
/** Stable opaque identity; numbered display labels distinguish equal names without Slack IDs. */
export function reconcile(
  record: StoredSession,
  source: SlackSource,
  people: SlackPerson[],
  now: number,
) {
  const state = record.slack!;
  const oldIds = new Set(Object.values(state.mapping));
  const manual = record.session.participants.filter((p) => !oldIds.has(p.id));
  const used = new Set(manual.map((p) => p.name.toLocaleLowerCase("nl")));
  const mapping: Record<string, string> = {};
  const imported = people.map((p) => {
    const id = state.mapping[p.slackId] ?? crypto.randomUUID();
    mapping[p.slackId] = id;
    let name = p.name;
    let suffix = 1;
    while (used.has(name.toLocaleLowerCase("nl"))) {
      const label = ` (${++suffix})`;
      name = p.name.slice(0, 32 - label.length).trimEnd() + label;
    }
    used.add(name.toLocaleLowerCase("nl"));
    return { id, name };
  });
  if (manual.length + imported.length > 100)
    throw new RequestError(400, "slack_too_many");
  record.session = createSession(
    record.session.id,
    [...manual, ...imported],
    record.preferredCount,
  );
  state.source = source;
  state.mapping = mapping;
  state.count = imported.length;
  state.syncedAt = new Date(now).toISOString();
}
export function queueResult(record: StoredSession) {
  const draw = record.session.activeDraw,
    slack = record.slack;
  if (!draw || !slack?.source) return;
  const identities = new Map(
    Object.entries(slack.mapping).map(([slackId, participantId]) => [
      participantId,
      slackId,
    ]),
  );
  slack.job = {
    drawId: draw.id,
    source: { ...slack.source },
    names: draw.spins.map(
      (spin) =>
        record.session.participants.find((p) => p.id === spin.winnerId)!.name,
    ),
    mentionIds: draw.spins.map((spin) => identities.get(spin.winnerId) ?? null),
    status: "pending",
    readyAt: Math.max(
      ...draw.spins.map((s) => Date.parse(s.startAt) + s.durationMs),
    ),
  };
  if (slack.channelRound && record.scheduledDraw)
    slack.card = {
      kind: "winner",
      names: [...slack.job.names],
      mentionIds: [...slack.job.mentionIds!],
      participants: draw.participantIds.length,
      startAt: Date.parse(record.scheduledDraw.startAt),
      status: "pending",
      readyAt: slack.job.readyAt,
      attempts: 0,
    };
}
/** A channel round that ended without a draw says so in its call, not in a thread. */
export function queueChannelNotice(
  record: StoredSession,
  notice: ChannelNotice,
  now: number,
) {
  const slack = record.slack;
  if (!slack?.channelRound || !slack.source || !record.scheduledDraw) return;
  slack.card = {
    kind: notice,
    startAt: Date.parse(record.scheduledDraw.startAt),
    status: "pending",
    readyAt: now,
    attempts: 0,
  };
}
export function resultBody(job: SlackJob) {
  const theme = themes[reactionVariant(job.source.reactionName)];
  const heading = `${theme.icon} Het rad heeft gesproken!\n`;
  const ending = `${job.names.length === 1 ? "Jij mag" : "Jullie mogen"} ${theme.drink} halen!`;
  const text = `${heading}${job.names.join(" · ")}\n${ending}`;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Only server-resolved identities become mention elements. Names remain literal text.
  const elements: (
    | { type: "text"; text: string }
    | { type: "user"; user_id: string }
  )[] = [{ type: "text", text: heading }];
  job.names.forEach((name, index) => {
    if (index) elements.push({ type: "text", text: " · " });
    const id = job.mentionIds?.[index];
    elements.push(
      id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT"
        ? { type: "user", user_id: id }
        : { type: "text", text: name },
    );
  });
  elements.push({
    type: "text",
    text: `\n${ending}`,
  });
  return {
    channel: job.source.channelId,
    thread_ts: job.source.parentMessageTs,
    text: escaped,
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    // Channel rounds show the winner in their updated call instead.
    reply_broadcast: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
type PostOutcome =
  | { status: "posted"; postedMessageTs: string }
  | { status: "failed" | "uncertain"; retryAt: number };
export async function postMessage(
  api: SlackApiClient,
  channelId: string,
  body: Record<string, unknown>,
): Promise<PostOutcome> {
  try {
    const result = await api.call("chat.postMessage", body);
    if (
      result.channel !== channelId ||
      typeof result.ts !== "string" ||
      !/^\d{10}\.\d{6}$/.test(result.ts)
    )
      throw new SlackError("slack_response", 60000, true);
    return { status: "posted", postedMessageTs: result.ts };
  } catch (error) {
    return {
      status:
        error instanceof SlackError && !error.uncertain
          ? "failed"
          : "uncertain",
      retryAt:
        Date.now() + (error instanceof SlackError ? error.retryAfterMs : 60000),
    };
  }
}
/** Rewrites one of the bot's own messages; the response must name that message. */
export async function updateMessage(
  api: SlackApiClient,
  body: { channel: string; ts: string } & Record<string, unknown>,
): Promise<{ status: "updated" } | { status: "failed"; retryAt: number }> {
  try {
    const result = await api.call("chat.update", body);
    if (result.channel !== body.channel || result.ts !== body.ts)
      throw new SlackError("slack_response");
    return { status: "updated" };
  } catch (error) {
    return {
      status: "failed",
      retryAt:
        Date.now() + (error instanceof SlackError ? error.retryAfterMs : 60000),
    };
  }
}
export function postResult(
  api: SlackApiClient,
  job: SlackJob,
): Promise<PostOutcome> {
  return postMessage(api, job.source.channelId, resultBody(job));
}
export const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});
/** Fixed text plus one server-built link; no names, mentions or client text. */
export function reminderBody(
  source: SlackSource,
  variant: WheelVariant,
  link: string,
  startAt: string,
  now: number,
) {
  const theme = themes[variant];
  const minutes = Math.max(1, Math.round((Date.parse(startAt) - now) / 60000));
  const heading = `⏰ Over ${minutes} ${minutes === 1 ? "minuut" : "minuten"} (${clock.format(Date.parse(startAt))}) draait het ${theme.name}! ${theme.icon}
Kijk live mee: `;
  const label = "Open het rad";
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    channel: source.channelId,
    thread_ts: source.parentMessageTs,
    text: escape(`${heading}${link}`),
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: heading },
              { type: "link", url: link, text: label },
            ],
          },
        ],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    reply_broadcast: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
export function postReminder(
  api: SlackApiClient,
  body: ReturnType<typeof reminderBody>,
): Promise<PostOutcome> {
  return postMessage(api, body.channel, body);
}
