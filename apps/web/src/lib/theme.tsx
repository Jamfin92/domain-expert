import { createContext, useContext, useEffect, useMemo, useState } from "react";

/**
 * Light, dark, or follow the OS.
 *
 * Written by hand rather than pulled from next-themes: this is Vite, not Next,
 * and the whole behaviour is a class on <html> plus a localStorage key. The
 * inline script in index.html reads the same key before first paint, so a dark
 * reload never flashes white.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "psq-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** What is actually on screen once "system" is resolved. */
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Private browsing and similar. The default is still correct.
  }
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined" ? false : prefersDark(),
  );

  // Follow the OS while the choice is "system". Without this, changing the
  // system appearance leaves the page stale until a reload.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved,
      setTheme: (t: Theme) => {
        setThemeState(t);
        try {
          localStorage.setItem(STORAGE_KEY, t);
        } catch {
          // Not fatal: the choice simply will not survive a reload.
        }
      },
    }),
    [theme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside a ThemeProvider");
  return ctx;
}
