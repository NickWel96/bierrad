export type WheelVariant = "beer" | "coffee" | "water";
export const wheelVariants: readonly WheelVariant[] = ["beer", "coffee", "water"];
export function isWheelVariant(value: unknown): value is WheelVariant {
  return (wheelVariants as readonly unknown[]).includes(value);
}
/**
 * Wheels anyone can open on their own: locally, in the switcher and as a plain
 * live session. Water exists only as a round of a channel-bound Koffierad.
 */
export type StandaloneVariant = Extract<WheelVariant, "beer" | "coffee">;
export const standaloneVariants: readonly StandaloneVariant[] = ["beer", "coffee"];
export function isStandaloneVariant(value: unknown): value is StandaloneVariant {
  return (standaloneVariants as readonly unknown[]).includes(value);
}
/**
 * Only the Bierrad starts with Sign in with Slack on a Friday message; the
 * Koffierad reaches Slack solely through its channel binding.
 */
export function startsWithSlack(value: unknown): value is "beer" {
  return value === "beer";
}
/** Slack reactions a variant counts; each variant reads only its own. */
export type SlackReaction = "beers" | "coffee" | "droplet";
/** The Slack app whose server-side credentials a variant uses; water shares the Koffierad app. */
export type SlackApp = "beer" | "coffee";
export interface WheelTheme {
  name: string;
  icon: string;
  winnerIcon: string;
  drink: string;
  reaction: SlackReaction;
  slackApp: SlackApp;
  storage: string;
  favicon: string;
  badge: string;
  question: string;
  crew: string;
  brigade: string;
  footer: string;
  finale: string;
  resultOne: string;
  resultMany: string;
  /** Closing line under the final result. */
  ending: string;
  /** Wheel segment colours; absent uses the default palette. */
  wheelColors?: readonly string[];
}
export const themes: Record<WheelVariant, WheelTheme> = {
  beer: {
    name: "Bierrad",
    icon: "🍻",
    winnerIcon: "🍺",
    drink: "bier",
    reaction: "beers",
    slackApp: "beer",
    storage: "bierrad",
    favicon: "./favicon.svg",
    badge: "Vrijdag begint hier",
    question: "Wie haalt deze week het bier?",
    crew: "vrijdagploeg",
    brigade: "bierbrigade",
    footer: "Met liefde gebrouwen voor de vrijdagmiddag.",
    finale: "DE BIERBRIGADE VAN DEZE WEEK",
    resultOne: "mag deze week het bier halen.",
    resultMany: "halen deze week het bier.",
    ending: "Het volk heeft dorst. Maak ons trots.",
  },
  coffee: {
    name: "Koffierad",
    icon: "☕",
    winnerIcon: "☕",
    drink: "koffie",
    reaction: "coffee",
    slackApp: "coffee",
    storage: "koffierad",
    favicon: "./coffee-icon.svg",
    badge: "Tijd voor een koffieronde",
    question: "Wie haalt de volgende koffie?",
    crew: "koffieploeg",
    brigade: "koffiebrigade",
    footer: "Met liefde gemaakt voor de koffiepauze.",
    finale: "DE KOFFIEBRIGADE VAN DEZE RONDE",
    resultOne: "mag de volgende koffie halen.",
    resultMany: "halen de volgende koffie.",
    ending: "De koffiepauze kan beginnen. Maak ons trots.",
    wheelColors: [
      "#d7a575",
      "#ebc9a6",
      "#91aaa0",
      "#f4dfbb",
      "#b9a6bc",
      "#caa58b",
      "#bec9a7",
      "#e6baab",
    ],
  },
  water: {
    name: "Waterrad",
    icon: "💧",
    winnerIcon: "🚰",
    drink: "water",
    reaction: "droplet",
    slackApp: "coffee",
    storage: "waterrad",
    favicon: "./water-icon.svg",
    badge: "Tijd voor een waterronde",
    question: "Wie haalt het water?",
    crew: "waterploeg",
    brigade: "waterbrigade",
    footer: "Met liefde getapt voor de dorstige afdeling.",
    finale: "DE WATERBRIGADE VAN DEZE RONDE",
    resultOne: "mag het water halen.",
    resultMany: "halen het water.",
    ending: "Rondje gemeentepils van de zaak! Hydrateer ons trots.",
    wheelColors: [
      "#7cc6d9",
      "#bfe5ee",
      "#9fc9b4",
      "#e3f3f6",
      "#a9b8e0",
      "#86b7c9",
      "#c4dfc9",
      "#d6e6f5",
    ],
  },
};
export function localHash(variant: WheelVariant): string {
  return `#/${variant}`;
}
/** The local wheel route of a variant, or undefined for any other hash. */
export function localVariant(hash: string): StandaloneVariant | undefined {
  if (!hash) return "beer";
  const name = /^#\/([a-z]+)$/.exec(hash)?.[1];
  return isStandaloneVariant(name) ? name : undefined;
}
/** Old water and Koffierad Slack routes open the Koffierad, so saved links keep working. */
export function retiredRoute(hash: string): string | undefined {
  return /^#\/(?:water|(?:water|coffee)-slack(?:\/[a-z]+)?)$/.test(hash)
    ? localHash("coffee")
    : undefined;
}
/** The variant whose Slack reaction this is; reactions are never shared. */
export function reactionVariant(reaction: SlackReaction): WheelVariant {
  return wheelVariants.find((v) => themes[v].reaction === reaction) ?? "beer";
}
