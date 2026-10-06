# Channel-bound Koffierad security review — 2026-10-05

Implementation review against SECURITY.md (section "Channel-bound Koffierad", added at the owner's explicit request on 2026-10-05). Not an independent audit.

## New surface

| Surface | Authorization | Notes |
| --- | --- | --- |
| `GET /auth/slack/channel/<C…/G…>` → callback | Sign in with Slack (unchanged OIDC checks: state/nonce cookie, issuer, audience, expiry, workspace, full member) | Channel ID is regex-validated and carried in the HttpOnly login cookie; failures land on `#/koffie-koppelen/<reason>` without details. |
| `GET/POST /api/channel` | Hex capability `locator.secret` (256-bit secret), admin or request role, SHA-256 hashes, timing-safe comparison | Origin allowlist, request rate limit. Strict command shapes; management is admin-only. No link can start a round: since 2026-10-06 (requested by the owner) `requestRound` is refused with 400 and rounds start only from `POST /slack/commands`. |
| `GET /api/channel` (word link) | 5-word viewer capability (50 bits), SHA-256 hash, timing-safe comparison | Same Origin allowlist and request rate limit. GET only (any POST is 405); returns only the latest round (`type: "view"`). |
| `POST /slack/commands` | Slack HMAC-SHA256 signature with `COFFEE_SLACK_SIGNING_SECRET`, 5-minute window | 8 KiB body bound, exact single-valued parameters, minutes 1–30, per-user request and creation limits, ephemeral replies. `ssl_check` is answered without acting. |
| `ChannelWheel` Durable Object | Reached only through the routes above | Named by `SHA-256("koffierad-channel:" + channelId)[0:32]`; the name grants nothing. Viewer pointers are instances named by `SHA-256("koffierad-viewer:" + words)[0:32]` that store only the channel's name and delete themselves when the channel rejects them. |

## Data and retention

- Stored per binding: channel ID, workspace ID, bot user ID, admin/request hashes, the raw request capability (already public in the channel; used for the call's link only on bindings without a viewer link, never returned in a DTO), the viewer hash and raw viewer word link (returned only to request and admin link holders; posted only as the call's "Kijk live mee" link), the channel name from the last signed `/koffierad` (`channel_name` matching `^[a-z0-9][a-z0-9._-]{0,79}$`, never `privategroup`/`directmessage`/`mpdm-*`; display only, rendered as React text; no extra scopes), default minutes, daily counter, idle expiry and, while a round is watchable (start + 3 minutes), that round's raw spectator capability. No binder, requester or participant data.
- Bindings expire 90 days after the last bind or round, or on unbind (`deleteAll`). Every access checks expiry; the alarm deletes expired state, and deletes the raw spectator capability after each round.
- Rounds are ordinary temporary LiveSessions: spectator-only (the host hash is of a discarded random value), one winner, expiry start + 1 hour, and a `slack-channel` grant that fails closed when the coffee login or bot secrets are removed. The bot user ID is a private exclusion list and never appears in DTOs.

## Slack behaviour

- Scopes added: `reactions:write` (only `reactions.add` of `:coffee:` on the bot's own call message) and `commands`. No `channels:read`, history, events or interactivity.
- Messages are fixed text with server-built links (`FRONTEND_URL` + fragment), `mrkdwn: false`, `parse: none`, no link names, no unfurls. The call is top-level and its "Kijk live mee" links to the view-only word link (older bindings: the fixed channel page); the winner result is a thread reply without `reply_broadcast`. Since 2026-10-06 the settled round rewrites its call instead (see below); there are no thread notices any more. Result mentions use only server-frozen identities, as before.
- Rounds are claimed before I/O. A definite rejection of the call clears the round; an uncertain result is not retried. Reaction refreshes happen at most once per minute and never within 30 seconds of the final check, so a refresh cannot block the draw.

## Accepted limitations

- The request link is bearer access and is posted in the channel (visible to Slack Connect members). Mitigations: one active round per channel, 20 rounds per 24 hours, creation rate limits, admin rotation and unbind.
- The viewer word link has only 50 bits and lives as long as the binding (up to 90 days idle, longer while rounds keep it alive). It only shows the latest round of one channel, never commands; guessing is bounded by the request rate limit, and the admin can replace it with a new channel link. Because every call posts it, everyone who can read the channel (including Slack Connect members) can watch along until then, and so can anyone who sees it on a screen. Bindings made before this change get one on their next rotation or rebind.
- Any full workspace member can rebind a channel and so replace its links; the confirmation post makes this visible in the channel.
- Anyone Slack lets run `/koffierad` in a bound channel (including guests) can start a round, as requested ("iedereen").
- The slash command keys bindings by channel ID only; the app is installed in a single workspace (`org_deploy_enabled: false`).
- If the Worker cannot answer within about 2.5 seconds, the person gets a generic "wordt aangevraagd" reply while the round continues via `waitUntil`.

## Verification

- `worker/tests/channel.test.ts`: signature verification (wrong secret, altered body, stale or malformed headers), strict slash parsing, channel input parsing, fixed message bodies, notices for empty/unreadable rounds, refresh margin, bot exclusion, and a Miniflare integration with a fake Slack. That integration covers: a refused binding when the bot is not in the channel, binding via the login flow, no secrets stored, role checks, strict shapes, rounds from the link and the slash command, one round at a time, a spectator DTO without Slack data, the final check without the bot, one winner in the thread, the raw spectator capability being wiped, forged/stale/unbound slash commands, rotation and unbind, and a viewer word link that is absent from the confirmation and is the call's only link, refuses every command, sees only the round, and stops working (pointer removed) after rotation and unbind.
- `src/tests/channel.test.ts`: exact fragment routes, bearer-only client requests, sanitized error messages.
- Real-workspace acceptance still requires the owner to update the Koffierad app, configure `COFFEE_SLACK_SIGNING_SECRET` and deploy.

## Water rounds review — 2026-10-05

Requested by the user: `/waterrad` and water rounds on the existing channel binding, so the fixed channel page (always open on a screen) follows the round's theme; one round at a time per channel; the shared daily limit raised from 20 to 25. Reviewed against every SECURITY.md section, which now records the water rounds, the shared limit, `:droplet:` and the second command.

- No new endpoint, secret, scope, capability, Durable Object class or migration. `/waterrad` is a second command of the Koffierad app on the same `/slack/commands` endpoint and is verified with the same `COFFEE_SLACK_SIGNING_SECRET`, timestamp window, byte bound, exact-parameter parsing and per-user rate limits. The command name is matched exactly against an allowlist; anything else stays `invalid`.
- The channel's object name is still derived from `koffierad-channel:<id>`, so coffee and water share one binding, one set of links, one active round and one daily counter. Existing bindings, links and word links keep working unchanged.
- The round variant comes from the signed command (`/koffierad` is coffee, `/waterrad` is water; the earlier optional `variant` field on `requestRound` went with that command on 2026-10-06). Rounds and the binding store only this non-sensitive enum (`lastVariant` for idle screens). DTOs expose it to the same link holders that already see the round; it never authorizes anything or selects any object.
- Water rounds add the bot's own `:droplet:` (existing `reactions:write`), count only `:droplet:` through the server-side theme, exclude the bot as before, and post fixed water texts; notices are derived from the frozen reaction. The winner broadcast rule was unchanged then (superseded on 2026-10-06, below).
- Refused requests name the running round's kind (for example "Er loopt al een waterronde"); they contain no names, IDs or links.

Automated coverage: slash parsing for both commands, water call and notice texts, and the real Worker/SQLite channel suite now also starts a water round via `/waterrad`, checks the 💧 call and reaction, the theme in status and word-link DTOs, mutual blocking with coffee, a droplet-only participant list without the bot, the broadcast water result, the idle theme and the shared counter (25 per day). Invalid variants are refused.

## Settled call review — 2026-10-06

Requested by the owner: the channel was hard to read with a top-level call plus a broadcast winner per round ("replied to a thread: …" each time), and reviews will add another message later. Each round now keeps one message in the channel. Reviewed against every SECURITY.md section, which records the change under the channel-bound Koffierad.

- **Call:** a bold title with the fixed start time ("☕ Koffieronde om 14:58"), one action line with the server-built "Kijk live mee" link and a quiet `context` line in `plain_text`. The relative "over N minuten" is gone because it goes stale.
- **Settled call:** after the draw (or a skipped round) the server rewrites the bot's own call with `chat.update`: title, 🏆 and the winner as a mention element (server-frozen identity, else literal text), "N deden mee", or the fixed notice. No link or capability remains. It uses the existing `chat:write` scope, `parse: none`, `mrkdwn: false`, no link names or unfurls, and an escaped fallback.
- **Thread:** the winner reply stays (it is what notifies the winner; edits do not notify) but is never broadcast. Notices are no longer posted in the thread; the call shows them.
- **Delivery:** the update is a separate job on the temporary session (`slack.card`), claimed and persisted before I/O, armed for crash recovery and erased with the session. Only the stored call `ts` of that round is targeted and Slack's response must name the same channel and `ts`. Updates are idempotent, so a rejected or uncertain update is tried again, at most three times; after that the call keeps its old text and the thread reply remains the official result. Bierrad sessions are unchanged (their parent message belongs to a person and is never edited).
- No new endpoint, secret, scope, capability, storage class or migration; nothing new is retained.

Automated coverage: call and settled bodies (title, mention vs literal name with `<!channel>` escaped in the fallback, participant count, notices, no link), card queueing for drawn, empty and unreadable rounds but not for Bierrad sessions, the deadline for pending cards, and in the real Worker/SQLite suite a non-broadcast thread result plus exactly one `chat.update` of the stored call for coffee, and for water a rejected update that is retried once and then succeeds without further updates.
