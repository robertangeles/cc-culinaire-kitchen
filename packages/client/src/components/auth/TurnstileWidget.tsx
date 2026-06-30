/**
 * @module components/auth/TurnstileWidget
 *
 * Renders a Cloudflare Turnstile challenge and surfaces the resulting
 * one-time token to the parent form. Zero external dependencies — it loads
 * Cloudflare's official script on demand and drives the explicit-render API.
 *
 * The site key is fetched at runtime from `GET /api/auth/turnstile-config`
 * so it stays admin-controllable from Settings → Integrations → Cloudflare
 * (no rebuild needed to rotate keys).
 *
 * Usage:
 *   const ref = useRef<TurnstileHandle>(null);
 *   <TurnstileWidget ref={ref} onToken={setToken} />
 *   // on a failed submit (token is single-use): ref.current?.reset();
 */

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Loader2, ShieldAlert } from "lucide-react";

/** Minimal shape of the global `window.turnstile` API we use. */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Imperative handle exposed to parent forms. */
export interface TurnstileHandle {
  /** Reset the widget so the user can solve a fresh challenge. */
  reset: () => void;
}

interface Props {
  /** Called with the token on success, or `null` when it expires/errors/resets. */
  onToken: (token: string | null) => void;
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Shared promise so the script is injected at most once per page. */
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error("Failed to load Turnstile"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, Props>(
  function TurnstileWidget({ onToken }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    // Keep the latest onToken without re-running the render effect.
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    const [siteKey, setSiteKey] = useState<string | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    );

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          onTokenRef.current(null);
        }
      },
    }));

    // 1. Fetch the public site key.
    useEffect(() => {
      let active = true;
      fetch("/api/auth/turnstile-config")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("config"))))
        .then((d: { siteKey?: string }) => {
          if (!active) return;
          if (d.siteKey) setSiteKey(d.siteKey);
          else setStatus("error");
        })
        .catch(() => {
          if (active) setStatus("error");
        });
      return () => {
        active = false;
      };
    }, []);

    // 2. Load the script and render the widget once the site key is known.
    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: "dark",
            callback: (token: string) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(null),
            "error-callback": () => onTokenRef.current(null),
          });
          setStatus("ready");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });

      return () => {
        cancelled = true;
        if (window.turnstile && widgetIdRef.current) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* widget already gone */
          }
          widgetIdRef.current = null;
        }
      };
    }, [siteKey]);

    if (status === "error") {
      return (
        <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          <ShieldAlert className="size-4 flex-shrink-0" />
          Security check couldn't load. Please refresh and try again.
        </div>
      );
    }

    return (
      <div className="min-h-[65px] flex items-center justify-center">
        {status === "loading" && (
          <div className="flex items-center gap-2 text-sm text-[#666666]">
            <Loader2 className="size-4 animate-spin" />
            Loading security check…
          </div>
        )}
        {/* Cloudflare renders its iframe into this container. */}
        <div ref={containerRef} className={status === "ready" ? "" : "hidden"} />
      </div>
    );
  },
);
