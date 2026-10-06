import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { wordLocator } from "../auth";
import type { PublicBeerWheelSession, SlackHostStatus } from "../../shared/protocol";
import type { JoinStatus } from "../../shared/reviews";

const origin = "http://127.0.0.1:5173";

test(
  "Worker: a Bierrad session reviews its winners via a join link and personal links, once per draw, and forgets",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let sub = "U00000007";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    let updates = 0;
    const reactors = ["U00000001", "U00000002", "U00000003"];
    const names: Record<string, string> = { U00000001: "Alice", U00000002: "Bob", U00000003: "Carol", U00000007: "Dana", U00000009: "Fem" };
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "beer-reviews-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); if (r.review && r.review.opensAt) { r.review.opensAt -= shift + 60000; r.review.closesAt -= shift + 60000; } if (r.slack.job) { r.slack.job.readyAt -= shift; } }); return this.alarm(); }
      async run() { return this.alarm(); }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: { SESSIONS: { className: "TestSession", useSQLite: true } },
            bindings: {
              ALLOWED_ORIGINS: origin,
              FRONTEND_URL: `${origin}/`,
              SLACK_BOT_TOKEN: "synthetic-beer-credential",
              SLACK_CLIENT_ID: clientId,
              SLACK_CLIENT_SECRET: "synthetic-beer-client-secret",
            },
            ratelimits: {
              CREATION_LIMIT: { namespace_id: "50", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "51", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "52", simple: { limit: 500, period: 60 } },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              const path = url.pathname.replace("/api/", "");
              if (path === "openid.connect.token") {
                const part = (v: object) => btoa(JSON.stringify(v)).replace(/=+$/, "");
                return Response.json({
                  ok: true,
                  access_token: "synthetic-user-credential",
                  id_token: `${part({})}.${part({
                    iss: "https://slack.com",
                    aud: clientId,
                    exp: Math.floor(Date.now() / 1000) + 300,
                    nonce,
                    sub,
                    "https://slack.com/team_id": "T00000001",
                  })}.c2ln`,
                });
              }
              if (path === "auth.revoke") return Response.json({ ok: true });
              if (path === "auth.test") return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00001" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                return Response.json({ ok: true, user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: names[id] } } });
              }
              if (path === "reactions.get")
                return Response.json({
                  ok: true,
                  type: "message",
                  channel: "C00000001",
                  message: { ts: url.searchParams.get("timestamp"), reactions: [{ name: "beers", count: reactors.length, users: reactors }] },
                });
              if (path === "chat.update") {
                updates++;
                return Response.json({ ok: false, error: "invalid_arguments" });
              }
              assert.equal(path, "chat.postMessage");
              const body = (await req.json()) as Record<string, unknown>;
              posts.push(body);
              ts++;
              return Response.json({ ok: true, channel: body.channel, ts: `${String(ts).slice(0, 10)}.${String(ts).slice(10)}` });
            },
          },
        ],
      }),
    );
    const call = (path: string, cap?: string, body?: object) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: origin,
          ...(cap ? { Authorization: `Bearer ${cap}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const navigate = (path: string, cookie?: string, init?: RequestInit) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        redirect: "manual",
        ...init,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init?.headers as Record<string, string>) },
      });
    const callback = (authorizeAt: string, cookie: string) => {
      const authorize = new URL(authorizeAt);
      nonce = authorize.searchParams.get("nonce")!;
      return navigate(`/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`, cookie);
    };
    const joinStart = (body: string, headers: Record<string, string> = {}) =>
      navigate("/auth/slack/join", undefined, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body,
      });
    const login = async (cap: string, user: string) => {
      const begin = await joinStart(new URLSearchParams({ capability: cap }).toString());
      assert.equal(begin.status, 303);
      const cookie = begin.headers.get("set-cookie")!.split(";")[0];
      assert.match(cookie, /join-beer-[a-f0-9]{32}\./);
      sub = user;
      const done = await callback(begin.headers.get("location")!, cookie);
      const personal = /#\/meedoen\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(done.headers.get("location")!);
      assert.ok(personal, done.headers.get("location")!);
      return personal[1];
    };
    const join = async (cap: string, body?: object) => {
      const r = await call("/api/join", cap, body);
      assert.equal(r.status, 200, await r.clone().text());
      return ((await r.json()) as { status: JoinStatus }).status;
    };
    try {
      // Dana starts a Bierrad session with Sign in with Slack.
      const begin = await navigate("/auth/slack/beer");
      sub = "U00000007";
      const started = await callback(begin.headers.get("location")!, begin.headers.get("set-cookie")!.split(";")[0]);
      const [, host, spectator] = /#\/host\/([a-f0-9.]+)\/([a-z-]+)$/.exec(started.headers.get("location")!)!;
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const session = sessions.get(sessions.idFromName(await wordLocator(spectator))) as unknown as {
        stored(): Promise<string>;
        land(): Promise<void>;
        run(): Promise<void>;
      };
      const hostView = async () => {
        const r = await call("/api/session", host);
        return ((await r.json()) as { session: PublicBeerWheelSession & { slack: SlackHostStatus } }).session;
      };
      const command = async (body: object, status = 200) => {
        const r = await call("/api/command", host, { revision: (await hostView()).revision, ...body });
        assert.equal(r.status, status, await r.clone().text());
        return r;
      };
      // Reviews are on by default for 30 minutes; the host can change both.
      assert.deepEqual((await hostView()).slack.reviews, { enabled: true, minutes: 30 });
      await command({ type: "setReviews", enabled: true, minutes: 45 }, 400);
      await command({ type: "setReviews", enabled: true, minutes: 15 });
      assert.deepEqual((await hostView()).slack.reviews, { enabled: true, minutes: 15 });
      assert.equal((await call("/api/command", spectator, { type: "setReviews", enabled: false, minutes: 15, revision: (await hostView()).revision })).status, 403);
      await command({ type: "slackImport", permalink: "https://synthetic.slack.com/archives/C00000001/p1234567890123456" });
      // A manually added name joins the draw but never votes or gets stars.
      await command({ type: "setParticipants", names: [...(await hostView()).participants.map((p) => p.name), "Erin"] });
      await command({ type: "setWinnerCount", count: 2 });

      // Draw: the winner post invites to review with the join link.
      await command({ type: "startDraw" });
      await session.land();
      const result = posts.at(-1)!;
      assert.equal(result.reply_broadcast, false);
      assert.match(String(result.text), /Beoordeel de halers tot \d\d:\d\d: http/);
      const joinCap = /#\/meedoen\/([a-f0-9]{32}\.[a-f0-9]{64})/.exec(JSON.stringify(result.blocks))![1];
      assert.ok(JSON.stringify(result.blocks).includes('"text":"Open de ronde"'));
      // The join link watches like a spectator but cannot vote or command.
      assert.deepEqual(await join(joinCap), { role: "join", variant: "beer", minutes: 15 });
      assert.equal((await call("/api/session", joinCap)).status, 200);
      assert.equal((await call("/api/command", joinCap, { type: "startDraw", revision: 0 })).status, 403);
      assert.equal((await call("/api/join", joinCap, { type: "review", drawId: "x", scores: [5], texts: [""] })).status, 403);
      // Logins: only from an allowed origin with a valid link in the body.
      const refused = await joinStart(`capability=${joinCap}`, { Origin: "https://evil.example" });
      assert.equal(refused.headers.get("location"), `${origin}/#/meedoen-login/expired`);
      const wrong = await joinStart(`capability=${joinCap.slice(0, 33)}${"0".repeat(64)}`);
      assert.equal(wrong.headers.get("location"), `${origin}/#/meedoen-login/expired`);
      const links: Record<string, string> = {
        Alice: await login(joinCap, "U00000001"),
        Bob: await login(joinCap, "U00000002"),
        Carol: await login(joinCap, "U00000003"),
      };
      const fem = await login(joinCap, "U00000009");
      const stored = JSON.parse(await session.stored());
      assert.ok(!JSON.stringify(stored.reviews).includes("U0000000"));
      const winners = stored.session.activeDraw.spins.map((s: { winnerId: string }) =>
        stored.session.participants.find((p: { id: string }) => p.id === s.winnerId).name as string,
      );
      // Each Slack participant reviews the other Slack winners, never themselves.
      let expectedVoters = 0;
      for (const [name, cap] of Object.entries(links)) {
        const reviewable = winners.filter((w: string) => w !== name && w !== "Erin");
        const status = await join(cap);
        assert.equal(status.role, "member");
        if (!reviewable.length) {
          assert.equal(status.member?.ballot, undefined, name);
          continue;
        }
        expectedVoters++;
        assert.deepEqual(status.member!.ballot!.winners.map((w) => w.name), reviewable, name);
      }
      assert.deepEqual((await join(fem)).member, {});
      const progress = async () => {
        const r = await call("/api/session", spectator);
        return ((await r.json()) as { session: PublicBeerWheelSession }).session.review;
      };
      assert.equal((await progress())?.eligible, expectedVoters);
      // Everyone eligible votes once; the last vote closes and posts.
      const before = posts.length;
      for (const [name, cap] of Object.entries(links)) {
        const ballot = (await join(cap)).member?.ballot;
        if (!ballot) continue;
        const scores = ballot.winners.map(() => 4);
        const texts = ballot.winners.map(() => `Koud & snel, zegt ${name.length}`);
        assert.equal((await call("/api/join", cap, { type: "review", drawId: ballot.drawId, scores, texts })).status, 200);
        assert.equal((await call("/api/join", cap, { type: "review", drawId: ballot.drawId, scores, texts })).status, 409);
      }
      await session.run();
      assert.equal(posts.length, before + 1);
      const review = posts.at(-1)!;
      assert.equal(review.reply_broadcast, false);
      assert.match(String(review.text), /⭐ Reviews voor /);
      assert.ok(JSON.stringify(review.blocks).includes("rich_text_list"));
      assert.ok(!String(review.text).includes("Erin"));
      // Beer never edits the parent message: it belongs to a person.
      assert.equal(updates, 0);
      const after = await session.stored();
      for (const secret of ["Koud", '"eligible"', '"voted"', '"totals"'])
        assert.ok(!after.includes(secret), secret);

      // A new draw cancels an open review: those votes are dropped, nothing is posted.
      await command({ type: "startDraw" });
      await session.land();
      const second = JSON.parse(await session.stored()).review;
      assert.equal(second.status, "open");
      let voted = false;
      for (const cap of Object.values(links)) {
        const ballot = (await join(cap)).member?.ballot;
        if (!ballot || voted) continue;
        assert.equal((await call("/api/join", cap, { type: "review", drawId: ballot.drawId, scores: ballot.winners.map(() => 5), texts: ballot.winners.map(() => "weg") })).status, 200);
        voted = true;
      }
      assert.ok(voted);
      assert.ok(JSON.stringify(JSON.parse(await session.stored()).review).includes("weg"));
      const count = posts.length;
      await command({ type: "startDraw" });
      const third = JSON.parse(await session.stored()).review;
      assert.notEqual(third.drawId, second.drawId);
      assert.ok(!JSON.stringify(third).includes("weg"));
      await session.land();
      // Only the new winner post; no review post for the cancelled draw.
      assert.equal(posts.length, count + 1);
      assert.match(String(posts.at(-1)!.text), /Het rad heeft gesproken/);

      // Reviews off: the next winner post has no invitation and no review starts.
      await command({ type: "setReviews", enabled: false, minutes: 15 });
      await command({ type: "startDraw" });
      assert.equal(JSON.parse(await session.stored()).review, undefined);
      await session.land();
      assert.ok(!String(posts.at(-1)!.text).includes("Beoordeel"));
      // A personal login needs reviews on.
      assert.equal((await joinStart(`capability=${joinCap}`)).headers.get("location"), `${origin}/#/meedoen-login/expired`);
      // Logout ends one personal link.
      assert.deepEqual(await (await call("/api/join", links.Alice, { type: "logout" })).json(), { type: "loggedOut" });
      assert.equal((await call("/api/join", links.Alice)).status, 404);
      assert.equal((await call("/api/session", links.Alice)).status, 404);
      assert.equal((await call("/api/join", links.Bob)).status, 200);
    } finally {
      await mf.dispose();
    }
  },
);
