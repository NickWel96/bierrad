import type {
  ChannelCommand,
  ChannelCommandResult,
} from "../../shared/channel";

const hex = String.raw`[a-f0-9]{32}\.[a-f0-9]{64}`;
/** The view-only word link of a channel: 5 chained words. */
const words = String.raw`[a-z]{2,8}(?:-[a-z]{2,8}){4}`;
export type ChannelBindFailure =
  | "denied"
  | "forbidden"
  | "expired"
  | "unavailable"
  | "busy"
  | "not_in_channel";
export type MemberLoginFailure =
  | "denied"
  | "forbidden"
  | "expired"
  | "unavailable"
  | "busy";
export type ChannelRoute =
  | { page: "bind"; failure?: ChannelBindFailure }
  | { page: "memberFailure"; failure: MemberLoginFailure }
  | { page: "wheel"; capability: string; requestCapability?: string }
  | { page: "view"; capability: string };
/** Channel links live only in the fragment, never in storage or requests to Pages. */
export function parseChannelRoute(hash: string): ChannelRoute | null {
  const bind =
    /^#\/koffie-koppelen(?:\/(denied|forbidden|expired|unavailable|busy|not_in_channel))?$/.exec(
      hash,
    );
  if (bind)
    return {
      page: "bind",
      ...(bind[1] ? { failure: bind[1] as ChannelBindFailure } : {}),
    };
  const member = /^#\/koffie-login\/(denied|forbidden|expired|unavailable|busy)$/.exec(
    hash,
  );
  if (member)
    return { page: "memberFailure", failure: member[1] as MemberLoginFailure };
  const request = new RegExp(`^#/koffie/(${hex})$`).exec(hash);
  if (request) return { page: "wheel", capability: request[1] };
  const view = new RegExp(`^#/koffie/(${words})$`).exec(hash);
  if (view) return { page: "view", capability: view[1] };
  const admin = new RegExp(`^#/koffie-beheer/(${hex})/(${hex})$`).exec(hash);
  return admin
    ? { page: "wheel", capability: admin[1], requestCapability: admin[2] }
    : null;
}
export function channelLink(requestCapability: string): string {
  return `${location.origin}${location.pathname}#/koffie/${requestCapability}`;
}
/** Without the scheme: short enough to type on another screen. */
export function channelViewLink(viewerCapability: string): string {
  return `${location.host}${location.pathname}#/koffie/${viewerCapability}`;
}
/** The word link as a route, to open it here for just watching. */
export function channelViewRoute(viewerCapability: string): string {
  return `#/koffie/${viewerCapability}`;
}
export function channelBindUrl(apiUrl: string, channelId: string): string {
  return `${apiUrl}/auth/slack/channel/${channelId}`;
}
const messages: Record<string, string> = {
  round_active: "Er loopt al een ronde. Kijk mee of doe mee onder de oproep in Slack.",
  round_limit: "Vandaag zijn er al genoeg rondes gestart. Morgen weer!",
  slack_post_failed:
    "Het Koffierad kon niet in het kanaal posten. Nodig de Koffierad-bot uit met /invite @Koffierad.",
  slack_uncertain:
    "Het is onzeker of de oproep is geplaatst. Kijk even in het kanaal voordat je het opnieuw probeert.",
  rate_limited: "Even rustig aan. Probeer over een minuut opnieuw.",
  unavailable:
    "Deze link werkt niet meer. Vraag de beheerder van het kanaal om een nieuwe aanvraaglink.",
  forbidden: "Alleen de beheerder van dit Koffierad kan dit aanpassen.",
  review_closed: "Stemmen is voorbij. De reviews staan in Slack.",
  review_done: "Je hebt al gestemd. Bedankt!",
  review_forbidden:
    "Je kunt deze ronde niet beoordelen: je deed niet mee of je bent zelf de haler.",
  invalid: "Geef alle halers sterren; een review mag hooguit 280 tekens zijn.",
};
export class ChannelApiError extends Error {
  constructor(public code: string) {
    super(
      messages[code] ??
        "Het Koffierad is nu niet bereikbaar. Probeer het zo opnieuw.",
    );
  }
}
export async function channelRequest(
  apiUrl: string,
  capability: string,
  command?: ChannelCommand,
  fetcher: typeof fetch = fetch,
): Promise<ChannelCommandResult> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl.replace(/\/$/, "")}/api/channel`, {
      method: command ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${capability}`,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ChannelApiError("network");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ChannelApiError(
      data && typeof data === "object" && "code" in data
        ? String(data.code)
        : "network",
    );
  return data as ChannelCommandResult;
}
