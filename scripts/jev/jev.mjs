/**
 * Minimal client for TypeSafe's Jev (System One) API, for dev tooling only.
 * Nothing in the app imports this. Zero dependencies (Node 20+ fetch).
 *
 * Reads TYPESAFE_API_KEY from the environment: run with `node --env-file=.env ...`.
 * Never send secrets, production data or user details through this: it leaves the machine.
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// Pinned: an alias like jev-latest moves when a new release ships, which would silently change
// answers and invalidate any thresholds tuned in scripts/jev/rules.mjs.
export const MODEL = "jev-1.14.0";

/** Ask one or more typed questions about `state`. Retries 429/529 with exponential backoff. */
export async function ask(state, questions, { attempts = 5 } = {}) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set (run with: node --env-file=.env ...)");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 529) && attempt < attempts) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    throw new Error(`TypeSafe ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export const noul = (instructions) => ({ type: "noul", instructions });
export const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
