import { isChannelVariant, type ChannelVariant } from "../shared/channel";
import { reviewBody, settledCallBody } from "./channel/messages";
import { themes, type WheelVariant } from "../shared/variant";
import { SlackApiClient, SlackError } from "./slack/api";
import {
  SlackReactionParticipantSource,
  parseSlackPermalink,
  type SlackSource,
} from "./slack/source";
import {
  reconcile,
  postMessage,
  postResult,
  updateMessage,
  MAX_CARD_ATTEMPTS,
  postReminder,
  reminderBody,
  MAX_REMINDER_POSTS,
} from "./slack/state";
import {
  CHANNEL_GRANT,
  LOGIN_GRANT,
  slackAllowed,
  slackCeiling,
  slackEnvironment,
  type SlackSecrets,
} from "./slack/access";
import { getCapabilities } from "../src/domain/capabilities";
import { DurableObject } from "cloudflare:workers";
import {
  equalHash,
  hashSecret,
  parseCapability,
  pseudonym,
  randomHex,
} from "./auth";
import {
  closeReview,
  openReview,
  reviewBallot,
  settleReviewJob,
  submitReview,
} from "./reviews";
import {
  DEFAULT_SESSION_REVIEW_SETTINGS,
  MAX_MEMBERS,
  type JoinResult,
  type ReviewBallot,
} from "../shared/reviews";
import { createSession } from "../src/domain/drawEngine";
import { SCHEDULE_RETENTION_MS } from "../shared/retention";
import {
  advance,
  channelRefreshAt,
  executeScheduledDraw,
  START_DELAY_MS,
  mutate,
  newSession,
  nextDeadline,
  publicSession,
  RequestError,
  type StoredSession,
} from "./session";
import { frontend, json } from "./http";
import type { ClientRole } from "../src/domain/models";
import type { ServerToClientMessage } from "../shared/protocol";

interface Attachment {
  role: ClientRole;
  window: number;
  messages: number;
}
export class LiveSession extends DurableObject<Env & SlackSecrets> {
  private read(): StoredSession | undefined {
    if (
      !this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'session'")
        .toArray().length
    )
      return undefined;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM session WHERE singleton = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.value) as StoredSession) : undefined;
  }
  private save(record: StoredSession) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO session VALUES (1, ?)",
      JSON.stringify(record),
    );
  }
  async initialize(
    hostHash: string,
    spectatorHash: string,
    grant?: { hash: string; expiresAt: number },
    variant: WheelVariant = "beer",
    locator?: string,
  ): Promise<string> {
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const record = newSession(hostHash, spectatorHash, Date.now(), variant);
    if (locator && /^[a-f0-9]{32}$/.test(locator)) record.locator = locator;
    if (grant) {
      record.slack = {
        grantHash: grant.hash,
        grantExpiresAt: grant.expiresAt,
        mapping: {},
      };
      record.expiresAt = Math.min(record.expiresAt, grant.expiresAt);
    }
    this.save(record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return new Date(record.expiresAt).toISOString();
  }
  /**
   * A coffee or water round of a channel-bound Koffierad: spectators only, one winner, the Slack
   * call message as source and a fixed start. Nobody receives host rights.
   */
  async initializeChannelRound(
    spectatorHash: string,
    source: SlackSource,
    startAt: number,
    excludeUserIds: string[],
    variant: ChannelVariant = "coffee",
    review?: { minutes: number; key: string; link: string },
  ): Promise<void> {
    const hostHash = await hashSecret(randomHex());
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const now = Date.now();
    const record = newSession(hostHash, spectatorHash, now, variant);
    record.preferredCount = 1;
    record.session = createSession(record.session.id, [], 1);
    record.expiresAt = startAt + SCHEDULE_RETENTION_MS;
    record.scheduledDraw = {
      startAt: new Date(startAt).toISOString(),
      status: "pending",
    };
    record.slack = {
      grantHash: CHANNEL_GRANT,
      grantExpiresAt: record.expiresAt,
      mapping: {},
      source: { ...source },
      channelRound: true,
      excludeUserIds: [...excludeUserIds],
      // The first read waits a minute: right after posting only the bot reacted.
      nextImportAt: now + 60000,
    };
    if (review) record.review = { ...review, status: "waiting" };
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
  }
  /** True once a channel round no longer blocks the next: drawn and stopped, skipped or gone. */
  async channelRoundSettled(): Promise<boolean> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return true;
    // Evaluate the current phase without waiting for the alarm; nothing is saved.
    advance(record, Date.now());
    return (
      record.session.state === "finished" ||
      (record.scheduledDraw?.status === "skipped" && !record.session.activeDraw)
    );
  }
  private async expire() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: "unavailable" }));
        ws.close(4004, "unavailable");
      } catch {
        /* Already disconnected. */
      }
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  private message(
    record: StoredSession,
    role: ClientRole,
  ): ServerToClientMessage {
    return {
      type: "snapshot",
      session: {
        ...publicSession(record),
        ...(role === "host" && record.slack
          ? {
              slack: {
                enabled: slackAllowed(
                  record.slack.grantHash,
                  slackEnvironment(this.env, record.variant),
                ),
                source: record.slack.source
                  ? ("slack" as const)
                  : ("manual" as const),
                importing:
                  !!record.slack.importing &&
                  record.slack.importing.until > Date.now(),
                count: record.slack.count,
                syncedAt: record.slack.syncedAt,
                ...(record.slack.job
                  ? {
                      result: {
                        drawId: record.slack.job.drawId,
                        status: record.slack.job.status,
                        ...(record.slack.job.status === "failed"
                          ? { retryAt: record.slack.job.retryAt }
                          : {}),
                      },
                    }
                  : {}),
                ...(record.slack.reminder
                  ? {
                      reminder: {
                        startAt: record.slack.reminder.startAt,
                        status: record.slack.reminder.status,
                      },
                    }
                  : {}),
                ...(record.slack.grantHash === LOGIN_GRANT
                  ? {
                      reviews: {
                        enabled: (
                          record.reviews ?? DEFAULT_SESSION_REVIEW_SETTINGS
                        ).enabled,
                        minutes: (
                          record.reviews ?? DEFAULT_SESSION_REVIEW_SETTINGS
                        ).minutes,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      role,
      serverNow: Date.now(),
    };
  }
  private broadcast(record: StoredSession) {
    if (Date.now() >= record.expiresAt) return;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment) {
        ws.close(4003, "unavailable");
        continue;
      }
      try {
        ws.send(JSON.stringify(this.message(record, attachment.role)));
      } catch {
        /* No names or access codes in diagnostics. */
      }
    }
  }
  private async authenticate(secret: string) {
    // Hash before reading state: no await between read, authorization and mutation.
    const hash = await hashSecret(secret);
    const record = this.read();
    if (!record) throw new RequestError(404, "unavailable");
    if (Date.now() >= record.expiresAt) {
      await this.expire();
      throw new RequestError(404, "unavailable");
    }
    const role: ClientRole | undefined = equalHash(hash, record.hostHash)
      ? "host"
      : equalHash(hash, record.spectatorHash) ||
          this.joinRole(record, hash) !== undefined
        ? "spectator"
        : undefined;
    if (!role) throw new RequestError(404, "unavailable");
    return role;
  }
  /** Join and personal links of a session: both watch like spectators. */
  private joinRole(
    record: StoredSession,
    hash: string,
  ): { pseudonym?: string } | undefined {
    const reviews = record.reviews;
    if (!reviews?.joinHash) return;
    if (equalHash(hash, reviews.joinHash)) return {};
    const member = reviews.members?.find((m) => equalHash(hash, m.hash));
    return member ? { pseudonym: member.pseudonym } : undefined;
  }
  /**
   * Gives a login-started Slack session its review key and join link, once,
   * before anything can draw. Needs the session's own locator.
   */
  private async ensureReviewKeys() {
    const before = this.read();
    if (
      !before ||
      before.slack?.grantHash !== LOGIN_GRANT ||
      !before.locator ||
      before.reviews?.key
    )
      return;
    const app = frontend(this.env);
    if (!app) return;
    const join = randomHex(),
      key = randomHex();
    const joinHash = await hashSecret(join);
    const record = this.read();
    if (!record || record.reviews?.key || !record.locator) return;
    record.reviews = {
      ...(record.reviews ?? DEFAULT_SESSION_REVIEW_SETTINGS),
      key,
      joinHash,
      link: `${app.href}#/meedoen/${record.locator}.${join}`,
      members: [],
    };
    this.save(record);
  }
  async access(
    secret: string,
    command: unknown,
    locator?: string,
  ): Promise<Response> {
    try {
      // Sessions from before reviews learn their own name from the Worker.
      const known = this.read();
      if (
        known &&
        !known.locator &&
        locator &&
        /^[a-f0-9]{32}$/.test(locator)
      ) {
        known.locator = locator;
        this.save(known);
      }
      await this.ensureReviewKeys();
      // Hash an offered spectator link up front, so no await separates the
      // read below from the comparison and mutation.
      const offered =
        command &&
        typeof command === "object" &&
        "spectatorCapability" in command &&
        typeof command.spectatorCapability === "string"
          ? command.spectatorCapability
          : undefined;
      const parsed = parseCapability(offered ?? null);
      const offeredHash = parsed ? await hashSecret(parsed.secret) : undefined;
      const role = await this.authenticate(secret);
      // Re-read after the await, protecting concurrent requests/expiry.
      const record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      const advanced = advance(record, Date.now());
      if (advanced) {
        this.save(record);
        this.broadcast(record);
      }
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "slackImport"
      ) {
        return await this.importSlack(record, role, command);
      }
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "slackRetry" &&
        !slackAllowed(
          record.slack?.grantHash,
          slackEnvironment(this.env, record.variant),
        )
      )
        throw new RequestError(403, "forbidden");
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "setScheduledDraw" &&
        "startAt" in command &&
        command.startAt !== null &&
        record.slack
      ) {
        if (role !== "host") throw new RequestError(403, "forbidden");
        const ceiling = slackCeiling(
          record.slack,
          slackEnvironment(this.env, record.variant),
        );
        if (ceiling === undefined)
          throw new RequestError(403, "schedule_access_expires");
      }
      if (command !== null) {
        mutate(
          record,
          role,
          command,
          Date.now(),
          offeredHash && equalHash(offeredHash, record.spectatorHash)
            ? offered
            : undefined,
        );
        this.save(record);
        await this.openRoundReview();
      }
      if (Date.now() >= record.expiresAt) {
        await this.expire();
        return json({ type: "unavailable" });
      }
      this.broadcast(record);
      const result = this.message(record, role);
      await this.ctx.storage.setAlarm(nextDeadline(record));
      if (Date.now() >= record.expiresAt) {
        await this.expire();
        return json({ code: "unavailable" }, 404);
      }
      return json(result);
    } catch (error) {
      return json(
        {
          code:
            error instanceof RequestError || error instanceof SlackError
              ? error.code
              : "unavailable",
        },
        error instanceof RequestError
          ? error.status
          : error instanceof SlackError
            ? 400
            : 503,
      );
    }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const raw =
        request.headers
          .get("Sec-WebSocket-Protocol")
          ?.split(",")
          .map((p) => p.trim())
          .find((p) => p.startsWith("auth."))
          ?.slice(5) ?? null;
      const capability = parseCapability(raw);
      if (!capability) throw new RequestError(404, "unavailable");
      const role = await this.authenticate(capability.secret);
      const record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      if (this.ctx.getWebSockets().length >= 64)
        throw new RequestError(429, "rate_limited");
      if (advance(record, Date.now())) {
        this.save(record);
        this.broadcast(record);
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        role,
        window: Date.now(),
        messages: 0,
      } satisfies Attachment);
      server.send(JSON.stringify(this.message(record, role)));
      await this.ctx.storage.setAlarm(nextDeadline(record));
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": "bierrad" },
      });
    } catch (error) {
      return json(
        {
          code:
            error instanceof RequestError || error instanceof SlackError
              ? error.code
              : "unavailable",
        },
        error instanceof RequestError
          ? error.status
          : error instanceof SlackError
            ? 400
            : 503,
      );
    }
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) {
      await this.expire();
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      ws.close(4003, "unavailable");
      return;
    }
    if (Date.now() - attachment.window >= 60000) {
      attachment.window = Date.now();
      attachment.messages = 0;
    }
    if (
      ++attachment.messages > 12 ||
      typeof raw !== "string" ||
      raw.length > 256
    ) {
      ws.close(4008, "rate_limited");
      return;
    }
    ws.serializeAttachment(attachment);
    try {
      const message: unknown = JSON.parse(raw);
      if (
        !message ||
        typeof message !== "object" ||
        !("type" in message) ||
        message.type !== "ping" ||
        Object.keys(message).length !== 1
      ) {
        ws.send(JSON.stringify({ type: "error", code: "forbidden" }));
        return;
      }
      if (advance(record, Date.now())) {
        this.save(record);
        this.broadcast(record);
      }
      ws.send(JSON.stringify({ type: "pong", serverNow: Date.now() }));
      await this.ctx.storage.setAlarm(nextDeadline(record));
    } catch {
      ws.send(JSON.stringify({ type: "error", code: "invalid" }));
    }
  }
  webSocketClose(ws: WebSocket) {
    ws.close();
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "unavailable");
  }
  async alarm() {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) {
      await this.expire();
      return;
    }
    if (advance(record, Date.now())) {
      this.save(record);
      this.broadcast(record);
    }
    if (record.slack?.importing && record.slack.importing.until <= Date.now()) {
      delete record.slack.importing;
      record.revision++;
      this.save(record);
      this.broadcast(record);
    }
    await this.processSlackReminder();
    await this.processChannelRefresh();
    await this.processScheduledDraw();
    await this.processSlackResult();
    await this.processReview();
    await this.processCallCard();
    const latest = this.read();
    if (latest && Date.now() < latest.expiresAt)
      await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  /** Same claim-before-I/O discipline as results; ambiguous posts never repeat. */
  private async processSlackReminder() {
    const record = this.read();
    const reminder = record?.slack?.reminder;
    if (!record || Date.now() >= record.expiresAt || !reminder) return;
    const settle = (target: StoredSession, status = reminder.status) => {
      const r = target.slack!.reminder!;
      r.status = status;
      delete r.capability;
      delete r.retryAt;
      target.revision++;
      this.save(target);
      this.broadcast(target);
    };
    if (reminder.status === "posting") {
      if (Date.now() >= reminder.attemptedAt! + 120000)
        settle(record, "uncertain");
      return;
    }
    const due =
      reminder.status === "pending"
        ? reminder.readyAt
        : reminder.status === "failed" && reminder.capability
          ? (reminder.retryAt ?? Infinity)
          : Infinity;
    if (due > Date.now()) return;
    const slack = record.slack!;
    const env = slackEnvironment(this.env, record.variant);
    const app = frontend(this.env);
    if (
      Date.now() >= Date.parse(reminder.startAt) ||
      !slack.source ||
      !reminder.capability ||
      !app ||
      (slack.reminderPosts ?? 0) >= MAX_REMINDER_POSTS ||
      !slackAllowed(slack.grantHash, env)
    ) {
      settle(record, reminder.status === "pending" ? "skipped" : "failed");
      return;
    }
    // With reviews the thread gets the join link: watch, or log in to review.
    const join = record.reviews?.enabled ? record.reviews.link : undefined;
    const body = reminderBody(
      slack.source,
      record.variant ?? "beer",
      join ?? `${app.href}#/live/${reminder.capability}`,
      reminder.startAt,
      Date.now(),
      !!join,
    );
    const id = reminder.id;
    // Claim synchronously before any await. Persist + arm crash recovery before external I/O.
    reminder.status = "posting";
    reminder.attemptedAt = Date.now();
    reminder.attempts++;
    slack.reminderPosts = (slack.reminderPosts ?? 0) + 1;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const current = this.read();
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      current.slack?.reminder?.id !== id ||
      current.slack.reminder.status !== "posting"
    )
      return;
    if (
      !slackAllowed(
        current.slack.grantHash,
        slackEnvironment(this.env, current.variant),
      )
    ) {
      settle(current, "failed");
      return;
    }
    const result = await postReminder(
      new SlackApiClient(env.SLACK_BOT_TOKEN!),
      body,
    );
    const latest = this.read();
    const r = latest?.slack?.reminder;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      r?.id !== id ||
      r.status !== "posting"
    )
      return;
    // A definite rejection gets one automatic retry, but only before the start.
    if (
      result.status === "failed" &&
      r.attempts < 2 &&
      result.retryAt < Date.parse(r.startAt)
    ) {
      r.status = "failed";
      r.retryAt = result.retryAt;
      latest.revision++;
      this.save(latest);
      this.broadcast(latest);
      return;
    }
    settle(latest, result.status);
  }
  private async processChannelRefresh() {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    const at = channelRefreshAt(record);
    if (at === undefined || at > Date.now()) return;
    try {
      // Slack errors are absorbed inside and push the next attempt back.
      await this.importSlack(record, "host", {
        type: "slackImport",
        revision: record.revision,
      });
    } catch {
      // Refused before any Slack call (for example revoked access): back off.
      const current = this.read();
      if (current?.slack && Date.now() < current.expiresAt) {
        current.slack.nextImportAt = Date.now() + 60000;
        this.save(current);
      }
    }
  }
  private async processScheduledDraw() {
    let record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    const plan = record.scheduledDraw;
    if (!plan || plan.status === "skipped") return;
    if (plan.status === "refreshing") {
      if ((record.scheduleCheckUntil ?? 0) <= Date.now()) {
        executeScheduledDraw(record, Date.now(), false);
        this.save(record);
        this.broadcast(record);
      }
      return;
    }
    if (Date.now() < Date.parse(plan.startAt) - START_DELAY_MS) return;
    record.scheduledDraw = { ...plan, status: "refreshing" };
    record.scheduleCheckUntil = Date.now() + 120000;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    record = this.read();
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      record.scheduledDraw?.status !== "refreshing" ||
      record.scheduledDraw.startAt !== plan.startAt
    )
      return;
    let ready = Date.now() <= Date.parse(plan.startAt) + 60000;
    if (ready && record.slack?.source) {
      try {
        // One separately rate-limited final check, even after a recent normal refresh.
        const result = await this.importSlack(
          record,
          "host",
          {
            type: "slackImport",
            revision: record.revision,
          },
          true,
        );
        ready = result.ok;
      } catch {
        ready = false;
      }
    }
    record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    if (
      record.scheduledDraw?.status !== "refreshing" ||
      record.scheduledDraw.startAt !== plan.startAt
    )
      return;
    const authorized =
      !record.slack?.source ||
      slackAllowed(
        record.slack.grantHash,
        slackEnvironment(this.env, record.variant),
      );
    executeScheduledDraw(record, Date.now(), ready && authorized);
    this.save(record);
    this.broadcast(record);
    await this.openRoundReview();
  }
  /** Freezes who may review whom, under pseudonyms, as the draw starts. */
  private async openRoundReview() {
    let record = this.read();
    const key = record?.review?.key;
    if (!record || record.review?.status !== "waiting" || !key) return;
    if (!record.session.activeDraw) {
      // Skipped round: nothing to review, and the key goes now.
      delete record.review;
      this.save(record);
      return;
    }
    const ids = Object.keys(record.slack?.mapping ?? {});
    const pseudonyms = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await pseudonym(key, id)] as const),
      ),
    );
    record = this.read();
    if (!record || record.review?.status !== "waiting") return;
    openReview(record, pseudonyms);
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
  }
  /**
   * A form POST from the join page of a login-started session: allowed for
   * its join and personal links, a bounded number per minute. Resolves the
   * session's variant (its Slack app), or null.
   */
  async joinLoginAllowed(secret: string): Promise<WheelVariant | null> {
    const hash = await hashSecret(secret);
    const record = this.read();
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      !record.reviews?.enabled ||
      this.joinRole(record, hash) === undefined ||
      !slackAllowed(
        record.slack?.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    )
      return null;
    const reviews = record.reviews;
    const now = Date.now();
    if (now - (reviews.loginWindow ?? 0) >= 60000) {
      reviews.loginWindow = now;
      reviews.logins = 0;
    }
    if ((reviews.logins ?? 0) >= 30) return null;
    reviews.logins = (reviews.logins ?? 0) + 1;
    this.save(record);
    return record.variant ?? "beer";
  }
  /**
   * After Sign in with Slack: a personal link for this session only. Keeps a
   * pseudonym; a new login replaces that person's previous link.
   */
  async addMember(userId: string): Promise<string> {
    const secret = randomHex();
    const hash = await hashSecret(secret);
    const key = this.read()?.reviews?.key;
    if (!key) throw new RequestError(404, "unavailable");
    const name = await pseudonym(key, userId);
    const record = this.read();
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      !record.locator ||
      record.reviews?.key !== key
    )
      throw new RequestError(404, "unavailable");
    const members = (record.reviews.members ?? []).filter(
      (m) => m.pseudonym !== name,
    );
    while (members.length >= MAX_MEMBERS) members.shift();
    members.push({ hash, pseudonym: name });
    record.reviews.members = members;
    this.save(record);
    return `${record.locator}.${secret}`;
  }
  /** `/api/join`: the join page, or one person's own status, review and logout. */
  async joinAccess(secret: string, command: unknown): Promise<Response> {
    try {
      const hash = await hashSecret(secret);
      let record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      const who = this.joinRole(record, hash);
      if (!who) throw new RequestError(404, "unavailable");
      const member = who.pseudonym;
      if (command !== null) {
        const input = command as Record<string, unknown>;
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          !member
        )
          throw new RequestError(member ? 400 : 403, member ? "invalid" : "forbidden");
        if (input.type === "logout" && Object.keys(input).length === 1) {
          record.reviews!.members = record.reviews!.members!.filter(
            (m) => m.pseudonym !== member,
          );
          this.save(record);
          return json({ type: "loggedOut" } satisfies JoinResult);
        }
        if (
          input.type !== "review" ||
          Object.keys(input).some(
            (k) => !["type", "drawId", "scores", "texts"].includes(k),
          )
        )
          throw new RequestError(400, "invalid");
        const outcome = await this.submitRoundReview(member, input.drawId, {
          scores: input.scores,
          texts: input.texts,
        });
        if (outcome.code)
          throw new RequestError(outcome.status ?? 400, outcome.code);
        record = this.read();
        if (!record) throw new RequestError(404, "unavailable");
      }
      return json({
        type: "status",
        status: {
          role: member ? "member" : "join",
          variant: record.variant ?? "beer",
          minutes: (record.reviews ?? DEFAULT_SESSION_REVIEW_SETTINGS).minutes,
          ...(member ? { member: await this.memberRound(member) } : {}),
        },
      } satisfies JoinResult);
    } catch (error) {
      return json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
  }
  /** For a personal channel link: whether this person joined, and their ballot. */
  async memberRound(
    member: string,
  ): Promise<{ participating?: boolean; ballot?: ReviewBallot }> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return {};
    const ballot = reviewBallot(record, member, Date.now());
    if (ballot) return { participating: true, ballot };
    // Before a draw: a channel round's key, or a Bierrad session's own.
    const review = record.review;
    const key =
      review?.status === "waiting"
        ? review.key
        : review?.status === "open"
          ? undefined
          : record.reviews?.key;
    if (!key) return {};
    for (const id of Object.keys(record.slack?.mapping ?? {}))
      if (equalHash(await pseudonym(key, id), member))
        return { participating: true };
    return { participating: false };
  }
  /** One ballot per person; closes the review as soon as everyone voted. */
  async submitRoundReview(
    member: string,
    drawId: unknown,
    submission: unknown,
  ): Promise<{ code?: string; status?: number }> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt)
      return { status: 409, code: "review_closed" };
    try {
      if (submitReview(record, member, drawId, submission, Date.now()))
        closeReview(record, Date.now());
    } catch (error) {
      return error instanceof RequestError
        ? { status: error.status, code: error.code }
        : { status: 503, code: "unavailable" };
    }
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    return {};
  }
  private async importSlack(
    record: StoredSession,
    role: ClientRole,
    raw: object,
    finalCheck = false,
  ): Promise<Response> {
    const command = raw as Record<string, unknown>;
    if (
      role !== "host" ||
      !slackAllowed(
        record.slack?.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    )
      throw new RequestError(403, "forbidden");
    if (
      Object.keys(command).some(
        (k) => !["type", "revision", "permalink"].includes(k),
      ) ||
      ("permalink" in command && typeof command.permalink !== "string")
    )
      throw new RequestError(400, "invalid");
    if (
      command.revision !== record.revision ||
      !getCapabilities(role, record.session).canManageParticipants
    )
      throw new RequestError(409, "not_ready");
    if (!finalCheck && record.scheduledDraw?.status === "refreshing")
      throw new RequestError(409, "not_ready");
    const state = record.slack!;
    if (
      (state.importing?.until ?? 0) > Date.now() ||
      (state.retryImportAt ?? 0) > Date.now() ||
      (finalCheck
        ? (state.nextFinalImportAt ?? 0)
        : (state.nextImportAt ?? 0)) > Date.now()
    )
      throw new RequestError(429, "slack_rate_limited");
    const source =
      command.permalink !== undefined
        ? parseSlackPermalink(
            command.permalink,
            themes[record.variant ?? "beer"].reaction,
          )
        : state.source;
    if (!source) throw new RequestError(400, "slack_link");
    const id = crypto.randomUUID();
    state.importing = { id, until: Date.now() + 120000 };
    state.nextImportAt = Date.now() + 60000;
    if (finalCheck) state.nextFinalImportAt = Date.now() + 60000;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    try {
      const people = await new SlackReactionParticipantSource(
        new SlackApiClient(
          slackEnvironment(this.env, record.variant).SLACK_BOT_TOKEN!,
        ),
      ).getParticipants(source, state.excludeUserIds);
      const current = this.read();
      if (
        !current ||
        Date.now() >= current.expiresAt ||
        current.slack?.importing?.id !== id ||
        !slackAllowed(
          current.slack.grantHash,
          slackEnvironment(this.env, current.variant),
        )
      )
        throw new RequestError(409, "unavailable");
      reconcile(current, source, people, Date.now());
      delete current.slack.importing;
      current.revision++;
      this.save(current);
      this.broadcast(current);
      const result = this.message(current, role);
      await this.ctx.storage.setAlarm(nextDeadline(current));
      if (Date.now() >= current.expiresAt)
        throw new RequestError(404, "unavailable");
      return json(result);
    } catch (error) {
      const current = this.read();
      if (
        current &&
        Date.now() < current.expiresAt &&
        current.slack?.importing?.id === id
      ) {
        delete current.slack.importing;
        current.slack.nextImportAt = Math.max(
          current.slack.nextImportAt ?? 0,
          Date.now() +
            (error instanceof SlackError ? error.retryAfterMs : 60000),
        );
        current.slack.retryImportAt = current.slack.nextImportAt;
        current.revision++;
        this.save(current);
        this.broadcast(current);
        await this.ctx.storage.setAlarm(nextDeadline(current));
      }
      return json(
        {
          code:
            error instanceof SlackError
              ? error.code
              : error instanceof RequestError
                ? error.code
                : "slack_unavailable",
        },
        error instanceof SlackError && error.code === "slack_rate_limited"
          ? 429
          : 400,
      );
    }
  }
  private async processSlackResult() {
    const record = this.read();
    const job = record?.slack?.job;
    if (!record || Date.now() >= record.expiresAt || !job) return;
    if (job.status === "posting") {
      if (Date.now() >= job.attemptedAt! + 120000) {
        job.status = "uncertain";
        record.revision++;
        this.save(record);
        this.broadcast(record);
      }
      return;
    }
    if (job.status !== "pending" || job.readyAt > Date.now()) return;
    if (
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    ) {
      job.status = "failed";
      job.retryAt = Date.now() + 60000;
      record.revision++;
      this.save(record);
      this.broadcast(record);
      return;
    }
    // Claim synchronously before any await. Persist + arm crash recovery before external I/O.
    job.status = "posting";
    job.attemptedAt = Date.now();
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const current = this.read();
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      !slackAllowed(
        current.slack?.grantHash,
        slackEnvironment(this.env, current.variant),
      )
    )
      return;
    const result = await postResult(
      new SlackApiClient(
        slackEnvironment(this.env, record.variant).SLACK_BOT_TOKEN!,
      ),
      job,
    );
    const latest = this.read();
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      latest.slack?.job?.drawId !== job.drawId ||
      latest.slack.job.status !== "posting"
    )
      return;
    Object.assign(latest.slack.job, result);
    latest.revision++;
    this.save(latest);
    this.broadcast(latest);
  }
  /**
   * Rewrites a settled channel round's call. Same claim-before-I/O discipline
   * as posts, but an update is idempotent, so an uncertain one may be repeated
   * (at most MAX_CARD_ATTEMPTS times in total).
   */
  private async processCallCard() {
    const record = this.read();
    const card = record?.slack?.card,
      source = record?.slack?.source;
    if (!record || Date.now() >= record.expiresAt || !card || !source) return;
    if (card.status === "updating") {
      if (Date.now() < card.attemptedAt! + 120000) return;
      card.status = "pending";
    }
    if (card.status !== "pending" || card.readyAt > Date.now()) return;
    const variant = record.variant;
    if (
      card.attempts >= MAX_CARD_ATTEMPTS ||
      !isChannelVariant(variant) ||
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, variant),
      )
    ) {
      card.status = "failed";
      this.save(record);
      return;
    }
    card.status = "updating";
    card.attempts++;
    const attemptedAt = (card.attemptedAt = Date.now());
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const result = await updateMessage(
      new SlackApiClient(slackEnvironment(this.env, variant).SLACK_BOT_TOKEN!),
      settledCallBody(
        source.channelId,
        source.parentMessageTs,
        card.startAt,
        variant,
        card,
        record.review?.status === "open" ? record.review.link : undefined,
      ),
    );
    const latest = this.read();
    const current = latest?.slack?.card;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      current?.status !== "updating" ||
      current.attemptedAt !== attemptedAt
    )
      return;
    if (result.status === "updated") current.status = "updated";
    else if (current.attempts >= MAX_CARD_ATTEMPTS) current.status = "failed";
    else {
      current.status = "pending";
      current.readyAt = result.retryAt;
    }
    this.save(latest);
    await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  /**
   * Closes voting at its deadline, then posts the anonymous results once in
   * the thread: claimed before I/O, never repeated when delivery is uncertain,
   * retried at most once after a definite rejection.
   */
  private async processReview() {
    const record = this.read();
    const review = record?.review,
      source = record?.slack?.source;
    if (!record || Date.now() >= record.expiresAt || !review || !source) return;
    if (review.status === "open" && Date.now() >= review.closesAt!) {
      closeReview(record, Date.now());
      record.revision++;
      this.save(record);
      this.broadcast(record);
    }
    const job = review.job;
    if (!job) return;
    if (job.status === "posting") {
      if (Date.now() >= job.attemptedAt! + 120000) {
        settleReviewJob(job, "uncertain");
        this.save(record);
      }
      return;
    }
    if (job.status !== "pending" || job.readyAt > Date.now()) return;
    const variant = record.variant ?? "coffee";
    if (
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, variant),
      )
    ) {
      settleReviewJob(job, "failed");
      this.save(record);
      return;
    }
    job.status = "posting";
    job.attempts++;
    const attemptedAt = (job.attemptedAt = Date.now());
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const result = await postMessage(
      new SlackApiClient(slackEnvironment(this.env, variant).SLACK_BOT_TOKEN!),
      source.channelId,
      reviewBody(source.channelId, source.parentMessageTs, job.results),
    );
    const latest = this.read();
    const current = latest?.review?.job;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      current?.status !== "posting" ||
      current.attemptedAt !== attemptedAt
    )
      return;
    if (result.status === "failed" && current.attempts < 2) {
      current.status = "pending";
      current.readyAt = result.retryAt;
    } else settleReviewJob(current, result.status);
    this.save(latest);
    await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
}
