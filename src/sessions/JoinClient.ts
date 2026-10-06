import type { JoinCommand, JoinResult } from "../../shared/reviews";

const hex = String.raw`[a-f0-9]{32}\.[a-f0-9]{64}`;
export type JoinFailure = "denied" | "forbidden" | "expired" | "unavailable" | "busy";
export type JoinRoute =
  | { page: "join"; capability: string }
  | { page: "failure"; failure: JoinFailure };
/** A session's join or personal link; only ever in the fragment. */
export function parseJoinRoute(hash: string): JoinRoute | null {
  const join = new RegExp(`^#/meedoen/(${hex})$`).exec(hash);
  if (join) return { page: "join", capability: join[1] };
  const failure =
    /^#\/meedoen-login\/(denied|forbidden|expired|unavailable|busy)$/.exec(hash);
  return failure ? { page: "failure", failure: failure[1] as JoinFailure } : null;
}
const messages: Record<string, string> = {
  unavailable: "Deze link werkt niet meer: de sessie is voorbij of je bent uitgelogd.",
  forbidden: "Log eerst in met Slack om te stemmen.",
  review_closed: "Stemmen is voorbij. De reviews staan in Slack.",
  review_done: "Je hebt al gestemd. Bedankt!",
  review_forbidden:
    "Je kunt deze trekking niet beoordelen: je deed niet mee via Slack.",
  invalid: "Geef alle halers sterren; een review mag hooguit 280 tekens zijn.",
  rate_limited: "Even rustig aan. Probeer over een minuut opnieuw.",
};
export class JoinApiError extends Error {
  constructor(public code: string) {
    super(messages[code] ?? "Het rad is nu niet bereikbaar. Probeer het zo opnieuw.");
  }
}
export async function joinRequest(
  apiUrl: string,
  capability: string,
  command?: JoinCommand,
  fetcher: typeof fetch = fetch,
): Promise<JoinResult> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl.replace(/\/$/, "")}/api/join`, {
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
    throw new JoinApiError("network");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new JoinApiError(
      data && typeof data === "object" && "code" in data ? String(data.code) : "network",
    );
  return data as JoinResult;
}
