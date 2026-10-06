import { channelCopy, type ChannelVariant } from "../../shared/channel";
import { themes } from "../../shared/variant";
import { clock } from "../slack/state";

type Element =
  | { type: "text"; text: string; style?: { bold: true } }
  | { type: "link"; url: string; text: string }
  | { type: "user"; user_id: string };

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain readable fallback for notifications; never parsed by Slack. */
const fallback = (elements: Element[], names: string[] = []) => {
  let name = 0;
  return escape(
    elements
      .map((e) =>
        e.type === "link" ? e.url : e.type === "user" ? names[name++] : e.text,
      )
      .join(""),
  );
};
const options = {
  mrkdwn: false,
  parse: "none",
  link_names: false,
  unfurl_links: false,
  unfurl_media: false,
} as const;
/**
 * Fixed Koffierad channel messages. Only server-built links and times; no
 * names, mentions or client-supplied text. Never unfurled or broadcast.
 */
function body(channelId: string, elements: Element[]) {
  return {
    channel: channelId,
    text: fallback(elements),
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
    ],
    ...options,
  };
}
/**
 * One card per round in the channel: a bold title, one line of status and an
 * optional quiet line under it. Text elements are literal, never parsed.
 */
function card(
  variant: ChannelVariant,
  startAt: number,
  status: Element[],
  context?: string,
) {
  const theme = themes[variant],
    round = channelCopy[variant].round;
  const elements: Element[] = [
    {
      type: "text",
      text: `${theme.icon} ${round[0].toUpperCase()}${round.slice(1)} om ${clock.format(startAt)}`,
      style: { bold: true },
    },
    { type: "text", text: "\n" },
    ...status,
  ];
  return {
    elements,
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
      ...(context
        ? [
            {
              type: "context",
              elements: [{ type: "plain_text", text: context, emoji: true }],
            },
          ]
        : []),
    ],
  };
}
/** The call for a round; its own reaction (☕ or 💧) is added right after. */
export function callBody(
  channelId: string,
  spectatorLink: string,
  startAt: number,
  variant: ChannelVariant = "coffee",
) {
  const theme = themes[variant];
  const { elements, blocks } = card(
    variant,
    startAt,
    [
      {
        type: "text",
        text: `Klik op ${theme.icon} hieronder om mee te doen.\n`,
      },
      { type: "link", url: spectatorLink, text: "Kijk live mee" },
    ],
    `Het ${theme.name} kiest één ${theme.drink}haler.`,
  );
  return { channel: channelId, text: fallback(elements), blocks, ...options };
}
/** What a settled round shows in place of its call. */
export type CallOutcome =
  | {
      kind: "winner";
      names: string[];
      /** Server-frozen Slack identities in winner order; never from a client. */
      mentionIds: (string | null)[];
      participants: number;
    }
  | { kind: "empty" | "unreadable" };
/**
 * The call message rewritten once the round is over, so the channel keeps one
 * message per round. Details stay in the thread; the call has no link left.
 */
export function settledCallBody(
  channelId: string,
  ts: string,
  startAt: number,
  variant: ChannelVariant,
  outcome: CallOutcome,
) {
  const theme = themes[variant],
    copy = channelCopy[variant];
  let status: Element[];
  let context: string | undefined;
  let names: string[] = [];
  if (outcome.kind === "winner") {
    names = outcome.names;
    status = [{ type: "text", text: "🏆 " }];
    outcome.names.forEach((name, index) => {
      if (index) status.push({ type: "text", text: " · " });
      const id = outcome.mentionIds[index];
      status.push(
        id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT"
          ? { type: "user", user_id: id }
          : { type: "text", text: name },
      );
    });
    status.push({
      type: "text",
      text: ` ${outcome.names.length === 1 ? "haalt" : "halen"} ${theme.drink}`,
    });
    context = `${outcome.participants} ${outcome.participants === 1 ? "deed" : "deden"} mee`;
  } else
    status = [
      {
        type: "text",
        text:
          outcome.kind === "empty"
            ? `Niemand deed mee, dus het rad bleef stil. Dan maar zelf ${copy.tap}!`
            : `Het ${theme.name} kon de reacties niet lezen, dus er is niet gedraaid. Vraag gerust een nieuwe ronde aan.`,
      },
    ];
  const { elements, blocks } = card(variant, startAt, status, context);
  return {
    channel: channelId,
    ts,
    text: fallback(elements, names),
    blocks,
    ...options,
  };
}
/** Posting this also proves the bot is a member of the channel. */
export function boundBody(channelId: string, requestLink: string) {
  return body(channelId, [
    {
      type: "text",
      text: "☕ Het Koffierad is aan dit kanaal gekoppeld! Dit is ",
    },
    {
      type: "link",
      text: "het vaste Koffierad van dit kanaal",
      url: requestLink,
    },
    {
      type: "text",
      text: ": daar zie je steeds de huidige ronde en vraag je een nieuwe aan. Of typ /koffierad of /waterrad (met bijvoorbeeld 10 erachter voor tien minuten). Meedoen doe je door op ☕ of 💧 te klikken onder de oproep. Eerdere links van dit kanaal werken niet meer.",
    },
  ]);
}
