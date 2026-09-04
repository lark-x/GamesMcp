import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN.js";
import type { Locale } from "antd/es/locale/index.js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type ThemeMode = "light" | "dark";

type AntdLocaleModule = { default?: Record<string, unknown> } & Record<string, unknown>;

function resolveAntdLocale(mod: unknown): Locale {
  const unwrapped = (mod as AntdLocaleModule).default ?? mod;
  return unwrapped as unknown as Locale;
}

const THEME_STORAGE_KEY = "gip.themeMode";

function readInitialMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
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
      <ThemeModeContext.Provider value={value}>
        <ConfigProvider
          // antd's CJS-style locale d.ts exposes the value as a namespace; unwrap `default` at runtime.
          locale={resolveAntdLocale(zhCN)}
          theme={{
            algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
            token: {
              colorPrimary: mode === "dark" ? "#f8fafc" : "#0f172a",
              borderRadius: 8,
              fontFamily:
                "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
            },
          }}
        >
          <AntdApp>{children}</AntdApp>
        </ConfigProvider>
      </ThemeModeContext.Provider>
    </QueryClientProvider>
  );
}
