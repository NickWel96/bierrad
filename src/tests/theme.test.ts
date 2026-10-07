import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadScheme,
  saveScheme,
  schemeForKey,
} from "../services/ThemePreference";

const key = (
  key: string,
  extra: Partial<Parameters<typeof schemeForKey>[0]> = {},
) =>
  schemeForKey({
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: null,
    ...extra,
  });

test("D picks dark and L picks light, in either case", () => {
  assert.equal(key("d"), "dark");
  assert.equal(key("D"), "dark");
  assert.equal(key("l"), "light");
  assert.equal(key("L"), "light");
  assert.equal(key("m"), undefined);
  assert.equal(key("Escape"), undefined);
});

test("shortcuts stay quiet while typing, with modifiers or on key repeat", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"])
    assert.equal(
      key("d", { target: { tagName } as unknown as EventTarget }),
      undefined,
    );
  assert.equal(
    key("l", {
      target: {
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget,
    }),
    undefined,
  );
  assert.equal(
    key("d", { target: { tagName: "BUTTON" } as unknown as EventTarget }),
    "dark",
  );
  assert.equal(key("d", { ctrlKey: true }), undefined);
  assert.equal(key("d", { altKey: true }), undefined);
  assert.equal(key("l", { metaKey: true }), undefined);
  assert.equal(key("d", { repeat: true }), undefined);
});

test("the scheme follows the system until chosen and survives missing storage", (t) => {
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
  assert.equal(loadScheme(), undefined);
  saveScheme("dark");
  assert.equal(loadScheme(), "dark");
  data.set("bierrad.colorScheme.v1", "sepia");
  assert.equal(loadScheme(), undefined);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  assert.equal(loadScheme(), undefined);
  assert.doesNotThrow(() => saveScheme("light"));
});
