import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "gip.themeMode";

function readInitialMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch {
    // localStorage unavailable; fall through to light.
  }
  return "light";
}

const ThemeModeContext = createContext<{
  mode: ThemeMode;
  toggle: () => void;
}>({ mode: "light", toggle: () => undefined });

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      toggle: () =>
        setMode((current) => {
          const next = current === "light" ? "dark" : "light";
          try {
            window.localStorage.setItem(THEME_STORAGE_KEY, next);
          } catch {
            // Ignore persistence failures.
          }
          return next;
        }),
    }),
    [mode],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
    </QueryClientProvider>
  );
}

