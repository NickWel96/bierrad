import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  newSession,
  mutate,
  nextDeadline,
  publicSession,
  type StoredSession,
} from "../session";
import {
  reminderBody,
  REMINDER_LEAD_MS,
  REMINDER_MIN_LEAD_MS,
} from "../slack/state";
import type {
  CreatedSession,
  PublicBeerWheelSession,
} from "../../shared/protocol";

const now = Date.parse("2026-10-02T12:00:00Z");
const source = {
  channelId: "C00000001",
  parentMessageTs: "1234567890.123456",
  reactionName: "beers" as const,
};
const viewer = `${"a".repeat(32)}.${"b".repeat(64)}`;
const setup = (slack = true): StoredSession => {
  const r = newSession("host", "viewer", now);
  if (slack)
    r.slack = {
      grantHash: "slack-login",
      grantExpiresAt: now + 31 * 24 * 3600000,
      mapping: {},
      source: { ...source },
    };
  mutate(
    r,
    "host",
    { type: "setParticipants", names: ["Alice", "Bob"], revision: r.revision },
    now,
  );
  return r;
};
const schedule = (r: StoredSession, at: number, cap?: string) => ({
  type: "setScheduledDraw",
  startAt: new Date(at).toISOString(),
  ...(cap === undefined ? {} : { spectatorCapability: cap }),
  revision: r.revision,
});

test("reminder is opt-in, needs the verified spectator link and a Slack source", () => {
  let r = setup();
  const at = now + 10 * 60000;
  mutate(r, "host", schedule(r, at), now);
  assert.equal(r.slack!.reminder, undefined);
  // Unverified or mismatching links are refused outright.
  assert.throws(() => mutate(r, "host", schedule(r, at, viewer), now), {
    code: "forbidden",
  });
  assert.throws(
    () => mutate(r, "host", schedule(r, at, viewer), now, "other"),
    { code: "forbidden" },
  );
  assert.throws(() =>
    mutate(
      r,
      "host",
      { type: "setScheduledDraw", startAt: null, spectatorCapability: viewer, revision: r.revision },
      now,
      viewer,
    ),
  );
  mutate(r, "host", schedule(r, at, viewer), now, viewer);
  assert.deepEqual(
    { ...r.slack!.reminder, id: undefined },
    {
      id: undefined,
      startAt: new Date(at).toISOString(),
      readyAt: at - REMINDER_LEAD_MS,
      capability: viewer,
      status: "pending",
      attempts: 0,
    },
  );
  assert.equal(nextDeadline(r), at - REMINDER_LEAD_MS);
  // Never part of any DTO.
  assert.ok(!JSON.stringify(publicSession(r)).includes(viewer));
  // Manual mode, standalone and sessions without a Slack thread cannot opt in.
  r = setup();
  delete r.slack!.source;
  assert.throws(() => mutate(r, "host", schedule(r, at, viewer), now, viewer), {
    code: "slack_link",
  });
  r = setup(false);
  assert.throws(() => mutate(r, "host", schedule(r, at, viewer), now, viewer), {
    code: "slack_link",
  });
});

test("short plans post right away or not at all; every exit wipes the raw link", () => {
  const r = setup();
  mutate(r, "host", schedule(r, now + 60000, viewer), now, viewer);
  assert.equal(r.slack!.reminder!.readyAt, now);
  mutate(r, "host", schedule(r, now + REMINDER_MIN_LEAD_MS - 1, viewer), now, viewer);
  assert.equal(r.slack!.reminder, undefined);
  for (const exit of [
    { type: "setScheduledDraw", startAt: null },
    { type: "setScheduledDraw", startAt: new Date(now + 600000).toISOString() },
    { type: "startDraw" },
    { type: "slackManual" },
  ]) {
    const s = setup();
    mutate(s, "host", schedule(s, now + 600000, viewer), now, viewer);
    assert.equal(s.slack!.reminder!.capability, viewer);
    mutate(s, "host", { ...exit, revision: s.revision }, now);
    assert.equal(s.slack!.reminder, undefined);
    assert.ok(!JSON.stringify(s).includes(viewer));
  }
});

test("reminder message is fixed text with one server-built link", () => {
  const link = `https://example.test/bierrad/#/live/${viewer}`;
  const startAt = "2026-10-02T14:00:00.000Z";
  const body = reminderBody(source, "beer", link, startAt, Date.parse(startAt) - 120000);
  assert.equal(body.channel, source.channelId);
  assert.equal(body.thread_ts, source.parentMessageTs);
  assert.equal(body.reply_broadcast, false);
  assert.equal(body.unfurl_links, false);
  assert.equal(body.unfurl_media, false);
  assert.equal(body.link_names, false);
  assert.match(body.text, /^⏰ Over 2 minuten \(16:00\) draait het Bierrad!/);
  assert.deepEqual(body.blocks[0].elements[0].elements[1], {
    type: "link",
    url: link,
    text: "Open het rad",
  });
  const coffee = reminderBody(
    { ...source, reactionName: "coffee" },
    "coffee",
    link,
    startAt,
    Date.parse(startAt) - 50000,
  );
  assert.match(coffee.text, /Over 1 minuut .* Koffierad! ☕/);
});

test(
  "Worker posts the spectator link once in the thread, verifies it and never exposes it",
  { timeout: 40000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const sent: Record<string, unknown>[] = [];
    let mode = "success";
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "reminder-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      linkSlack() { this.edit(r => { r.slack = { grantHash: "slack-login", grantExpiresAt: Date.now() + 31 * 24 * 3600000, mapping: {}, source: { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "beers" } }; r.revision++; }); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      runAlarm() { return this.alarm(); }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: "http://127.0.0.1:5173",
              FRONTEND_URL: "http://127.0.0.1:5173/",
              SLACK_BOT_TOKEN: "synthetic-credential",
              SLACK_CLIENT_ID: "1000000000.2000000000",
              SLACK_CLIENT_SECRET: "synthetic-client-secret",
            },
            ratelimits: {
              CREATION_LIMIT: { namespace_id: "20", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "21", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "22", simple: { limit: 500, period: 60 } },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              assert.equal(url.origin + url.pathname, "https://slack.com/api/chat.postMessage");
              assert.equal(req.headers.get("authorization"), "Bearer synthetic-credential");
              sent.push((await req.json()) as Record<string, unknown>);
              if (mode === "reject")
                return Response.json({ ok: false, error: "not_in_channel" });
              return Response.json({ ok: true, channel: "C00000001", ts: "1234567890.999999" });
            },
          },
        ],
      }),
    );
    const call = (path: string, cap?: string, body?: object) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "http://127.0.0.1:5173",
          ...(cap ? { Authorization: `Bearer ${cap}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const snapshot = async (cap: string) =>
      ((await (await call("/api/session", cap)).json()) as {
        session: PublicBeerWheelSession;
      }).session;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const create = async () =>
        (await (await call("/api/sessions", undefined, {})).json()) as CreatedSession;
      const created = await create();
      const other = await create();
      const host = created.hostCapability,
        viewer = created.spectatorCapability;
      const namespace = await mf.getDurableObjectNamespace("SESSIONS");
      const stub = namespace.get(
        namespace.idFromName(host.split(".")[0]),
      ) as unknown as {
        linkSlack(): Promise<void>;
        stored(): Promise<string>;
        runAlarm(): Promise<void>;
      };
      const command = async (body: object) =>
        call("/api/command", host, {
          ...body,
          revision: (await snapshot(host)).revision,
        });
      assert.equal(
        (await command({ type: "setParticipants", names: ["Alice", "Bob"] })).status,
        200,
      );
      const plan = (cap?: unknown, ms = 60000) =>
        command({
          type: "setScheduledDraw",
          startAt: new Date(Date.now() + ms).toISOString(),
          ...(cap === undefined ? {} : { spectatorCapability: cap }),
        });
      // Without a Slack thread the opt-in is refused.
      assert.equal((await plan(viewer)).status, 409);
      await stub.linkSlack();
      // With reviews (the default) the reminder carries the join link instead;
      // this suite covers the spectator link, so reviews are off here.
      assert.equal(
        (await command({ type: "setReviews", enabled: false, minutes: 30 })).status,
        200,
      );
      // Host link, foreign, malformed or another session's link: never posted.
      const [locator] = host.split(".");
      for (const [cap, status] of [
        [host, 403],
        [`${locator}.${"0".repeat(64)}`, 403],
        [other.spectatorCapability, 400],
        ["bier", 400],
        [42, 400],
      ] as const)
        assert.equal((await plan(cap)).status, status, String(cap));
      assert.equal(sent.length, 0);
      // Due immediately (less than two minutes ahead): the alarm posts once.
      assert.equal((await plan(viewer)).status, 200);
      await wait(1500);
      await Promise.all([stub.runAlarm(), stub.runAlarm()]);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channel, "C00000001");
      assert.equal(sent[0].thread_ts, "1234567890.123456");
      assert.equal(sent[0].unfurl_links, false);
      assert.ok(
        JSON.stringify(sent[0].blocks).includes(
          `"url":"http://127.0.0.1:5173/#/live/${viewer}"`,
        ),
      );
      const hosted = await snapshot(host);
      assert.equal(hosted.slack?.reminder?.status, "posted");
      assert.ok(!JSON.stringify(hosted).includes(viewer));
      assert.equal((await snapshot(viewer)).slack, undefined);
      // The raw link is gone from storage once settled.
      assert.ok(!(await stub.stored()).includes(viewer));
      // A definite rejection is retried at most once, then wiped.
      mode = "reject";
      assert.equal((await plan(viewer, 5 * 60000)).status, 200);
      const pending = await snapshot(host);
      assert.equal(pending.slack?.reminder?.status, "pending");
      assert.ok((await stub.stored()).includes(viewer));
      assert.equal(sent.length, 1);
      assert.equal((await plan(viewer, 90000)).status, 200);
      await wait(1500);
      await stub.runAlarm();
      assert.equal(sent.length, 2);
      assert.equal((await snapshot(host)).slack?.reminder?.status, "failed");
      // Cancelling clears the retry and the stored link.
      assert.equal((await command({ type: "setScheduledDraw", startAt: null })).status, 200);
      assert.equal((await snapshot(host)).slack?.reminder, undefined);
      assert.ok(!(await stub.stored()).includes(viewer));
    } finally {
      await mf.dispose();
    }
  },
);
