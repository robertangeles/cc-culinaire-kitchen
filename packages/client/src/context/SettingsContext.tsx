/**
 * @module SettingsContext
 *
 * React context that fetches site settings once on mount and makes them
 * available to the entire component tree. Also applies page metadata
 * (title, description, favicon) via {@link usePageMeta}.
 *
 * Components that need settings values (e.g. chat window width) can
 * consume this context via the {@link useSettings} hook.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { usePageMeta } from "../hooks/usePageMeta.js";

/** Shape of the settings context value. */
interface SettingsContextValue {
  /** All site settings as a key-value map. */
  settings: Record<string, string>;
  /** True while the initial fetch is in progress. */
  isLoading: boolean;
  /** Force a refresh of the settings from the server. */
  refresh: () => Promise<void>;
}

const SettingsCtx = createContext<SettingsContextValue>({
  settings: {},
  isLoading: true,
  refresh: async () => {},
});

/**
 * Consume the global site settings from the nearest {@link SettingsProvider}.
 *
 * @returns The current settings context value.
 */
export function useSettings(): SettingsContextValue {
  return useContext(SettingsCtx);
}

/** Props for {@link SettingsProvider}. */
interface SettingsProviderProps {
  children: ReactNode;
}

/**
 * Provider that fetches site settings on mount and applies page metadata.
 * Wrap the application root (inside BrowserRouter) with this provider.
 */
export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data.settings);
    } catch {
      // Silently fail — settings are non-critical for app function
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchSettings();
  }, []);

  // Apply page meta (title, description, favicon) as a side effect
  usePageMeta(settings);

  return (
    <SettingsCtx.Provider value={{ settings, isLoading, refresh: fetchSettings }}>
      {children}
    </SettingsCtx.Provider>
  );
}
