// Light / dark / follow-the-system theme. The choice is a per-browser
// convenience, so it lives in localStorage; every access is guarded because
// storage can throw (private windows, blocked site data).
export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "vigilia.theme";
export const THEME_PREFS: ThemePref[] = ["light", "dark", "system"];

export function isThemePref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

function writePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Not persisted; the choice still applies until the page reloads.
  }
}

const query = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);
const systemDark = () => query()?.matches ?? false;

let current: ThemePref = readPref();
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  return current;
}

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(current, systemDark());
  root.style.colorScheme = root.dataset.theme;
}

export function setThemePref(pref: ThemePref) {
  current = pref;
  writePref(pref);
  applyTheme();
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Apply the stored choice and keep "system" in step with the OS setting. */
export function initTheme() {
  current = readPref();
  applyTheme();
  query()?.addEventListener("change", applyTheme);
}
