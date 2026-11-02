import { useSyncExternalStore } from "react";
import { getThemePref, setThemePref, subscribeTheme, type ThemePref } from "../lib/theme";

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  return [useSyncExternalStore(subscribeTheme, getThemePref), setThemePref];
}
