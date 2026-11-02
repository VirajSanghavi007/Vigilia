import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps the current choice at module scope, so each test imports a fresh copy.
async function load() {
  vi.resetModules();
  return import("../../src/lib/theme");
}

function mockSystem(dark: boolean) {
  const listeners: (() => void)[] = [];
  const mq = { matches: dark, addEventListener: vi.fn((_: string, l: () => void) => listeners.push(l)) };
  vi.stubGlobal("matchMedia", vi.fn(() => mq));
  return { mq, change(next: boolean) { mq.matches = next; listeners.forEach((l) => l()); } };
}

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root().dataset.theme;
  root().style.colorScheme = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme helpers", () => {
  it("recognises only the three choices", async () => {
    const { isThemePref, THEME_PREFS } = await load();
    expect(THEME_PREFS.every(isThemePref)).toBe(true);
    for (const v of ["", "Dark", "auto", null, undefined, 1]) expect(isThemePref(v)).toBe(false);
  });

  it("resolves system to the OS setting and keeps explicit choices", async () => {
    const { resolveTheme } = await load();
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads a stored choice and defaults to system", async () => {
    const { readPref, THEME_KEY } = await load();
    expect(readPref()).toBe("system");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readPref()).toBe("dark");
    localStorage.setItem(THEME_KEY, "purple");
    expect(readPref()).toBe("system");
  });

  it("defaults to system when storage throws", async () => {
    const { readPref } = await load();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readPref()).toBe("system");
  });
});

describe("applying the theme", () => {
  it("starts from the stored choice", async () => {
    localStorage.setItem("vigilia.theme", "dark");
    const { getThemePref, initTheme } = await load();
    expect(getThemePref()).toBe("dark");
    initTheme();
    expect(root().dataset.theme).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it("follows the OS for system, live", async () => {
    const os = mockSystem(true);
    const { initTheme } = await load();
    initTheme();
    expect(root().dataset.theme).toBe("dark");
    expect(os.mq.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    os.change(false);
    expect(root().dataset.theme).toBe("light");
    expect(root().style.colorScheme).toBe("light");
  });

  it("ignores the OS once a choice is explicit", async () => {
    const os = mockSystem(true);
    const { initTheme, setThemePref } = await load();
    initTheme();
    setThemePref("light");
    os.change(true);
    expect(root().dataset.theme).toBe("light");
  });

  it("treats a browser without matchMedia as light", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { initTheme } = await load();
    initTheme();
    expect(root().dataset.theme).toBe("light");
  });

  it("stores, applies and announces a new choice", async () => {
    const { setThemePref, getThemePref, subscribeTheme, THEME_KEY } = await load();
    const heard = vi.fn();
    const off = subscribeTheme(heard);
    setThemePref("dark");
    expect(getThemePref()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(root().dataset.theme).toBe("dark");
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    setThemePref("light");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(root().dataset.theme).toBe("light");
  });

  it("still applies a choice the browser cannot store", async () => {
    const { setThemePref, getThemePref } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => setThemePref("dark")).not.toThrow();
    expect(getThemePref()).toBe("dark");
    expect(root().dataset.theme).toBe("dark");
  });
});
