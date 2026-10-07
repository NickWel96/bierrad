import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import { VariantContext } from "../Theme";
import { ManualParticipantSource } from "../services/ManualParticipantSource";
import { LocalWinnerCountPreference } from "../services/WinnerCountPreference";
import { loadWeights, saveWeights } from "../services/RigPreference";
import { LocalSessionController } from "../sessions/LocalSessionController";
import { FinalResult } from "../components/FinalResult";
import { SlackControls } from "../components/SlackControls";

test("coffee roster, count and optional weights never overwrite legacy beer storage", async (t) => {
  const data = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const beer = new ManualParticipantSource(),
    coffee = new ManualParticipantSource("coffee");
  beer.save([{ id: "a", name: "Test A" }]);
  coffee.save([{ id: "b", name: "Test B" }]);
  assert.deepEqual(
    (await beer.getParticipants()).map((p) => p.name),
    ["Test A"],
  );
  assert.deepEqual(
    (await coffee.getParticipants()).map((p) => p.name),
    ["Test B"],
  );
  new LocalWinnerCountPreference().save(3);
  new LocalWinnerCountPreference("coffee").save(1);
  assert.equal(new LocalWinnerCountPreference().load(), 3);
  assert.equal(new LocalWinnerCountPreference("coffee").load(), 1);
  saveWeights({ a: 2 });
  saveWeights({ b: 4 }, "coffee");
  assert.deepEqual(loadWeights(), { a: 2 });
  assert.deepEqual(loadWeights("coffee"), { b: 4 });
  assert.ok(data.has("bierrad.participants.v1"));
});
test("coffee setup, finale and Slack controls consistently say coffee halen", async () => {
  const controller = new LocalSessionController();
  await controller.setParticipants([{ id: "a", name: "Test A" }]);
  const render = (child: import("react").ReactNode) =>
    renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: "coffee" }, child),
    );
  const setup = render(createElement(App, { controller }));
  assert.match(setup, /Koffierad/);
  assert.match(setup, /koffiehaler/);
  assert.match(setup, /DRAAI HET KOFFIERAD/);
  assert.doesNotMatch(setup, /bierhaler|Vrijdag begint|🍺|bier halen/i);
  const result = render(
    createElement(FinalResult, {
      winners: [{ id: "a", name: "Test A" }],
      onAgain() {},
      onSetup() {},
      canControl: true,
      disabled: false,
    }),
  );
  assert.match(result, /Jij mag koffie halen!/);
  assert.doesNotMatch(result, /bier|zetten|🍻/i);
  const slack = render(
    createElement(SlackControls, {
      status: { enabled: true, source: "slack", importing: false, count: 0 },
      locked: false,
      async onImport() {},
      async onManual() {},
    }),
  );
  assert.match(slack, /:coffee:/);
  assert.doesNotMatch(slack, /:beers:|🍻/);
  controller.dispose();
});
test("local routes, reactions and Slack apps come from one theme table", async () => {
  const {
    localHash,
    localVariant,
    reactionVariant,
    retiredRoute,
    standaloneVariants,
    themes,
    wheelVariants,
  } = await import("../../shared/variant");
  assert.equal(localVariant(""), "beer");
  assert.deepEqual(standaloneVariants, ["beer", "coffee"]);
  for (const variant of standaloneVariants)
    assert.equal(localVariant(localHash(variant)), variant);
  for (const variant of wheelVariants)
    assert.equal(reactionVariant(themes[variant].reaction), variant);
  // Water is only a channel round: no own local wheel.
  for (const hash of ["#/water", "#/slack", "#/live/x", "#/koffie-koppelen", "#/Coffee", "#/beer/"])
    assert.equal(localVariant(hash), undefined, hash);
  // Saved water links open the Koffierad instead.
  assert.equal(retiredRoute("#/water"), "#/coffee");
  // Old Slack starts of water and coffee too: only the Bierrad starts with Slack.
  for (const hash of ["#/water-slack", "#/water-slack/denied", "#/coffee-slack", "#/coffee-slack/busy"])
    assert.equal(retiredRoute(hash), "#/coffee", hash);
  for (const hash of ["", "#/coffee", "#/slack", "#/water/", "#/waterrad", "#/koffie/x"])
    assert.equal(retiredRoute(hash), undefined, hash);
  assert.equal(themes.beer.slackApp, "beer");
  assert.equal(themes.coffee.slackApp, "coffee");
});
test("the switcher offers only the Bierrad and Koffierad", async () => {
  const controller = new LocalSessionController();
  for (const variant of ["beer", "coffee", "water"] as const) {
    const page = renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: variant }, createElement(App, { controller })),
    );
    const nav = /<nav class="variant-switch"[^>]*>(.*?)<\/nav>/s.exec(page)?.[1] ?? "";
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["#/beer", "#/coffee"], variant);
    assert.doesNotMatch(nav, /Waterrad|💧/);
  }
  controller.dispose();
});
test("water setup, finale and Slack controls say water halen and count only :droplet:", async () => {
  const controller = new LocalSessionController();
  await controller.setParticipants([{ id: "a", name: "Test A" }]);
  const render = (child: import("react").ReactNode) =>
    renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: "water" }, child),
    );
  const setup = render(createElement(App, { controller }));
  assert.match(setup, /Waterrad/);
  assert.match(setup, /waterhaler/);
  assert.match(setup, /DRAAI HET WATERRAD/);
  assert.doesNotMatch(setup, /bierhaler|koffiehaler|Vrijdag begint|bier halen/i);
  const result = render(
    createElement(FinalResult, {
      winners: [{ id: "a", name: "Test A" }],
      onAgain() {},
      onSetup() {},
      canControl: true,
      disabled: false,
    }),
  );
  assert.match(result, /Jij mag water halen!/);
  assert.match(result, /Rondje gemeentepils van de zaak! Hydrateer ons trots\./);
  assert.doesNotMatch(result, /bier|koffie/i);
  const slack = render(
    createElement(SlackControls, {
      status: { enabled: true, source: "slack", importing: false, count: 0 },
      locked: false,
      async onImport() {},
      async onManual() {},
    }),
  );
  assert.match(slack, /:droplet:/);
  assert.doesNotMatch(slack, /:beers:|:coffee:/);
  controller.dispose();
});
test("water roster and count are stored apart from beer and coffee", () => {
  const data = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  try {
    new ManualParticipantSource("water").save([{ id: "w", name: "Test W" }]);
    new LocalWinnerCountPreference("water").save(1);
    assert.deepEqual([...data.keys()].sort(), [
      "waterrad.participants.v1",
      "waterrad.winnerCount.v1",
    ]);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
