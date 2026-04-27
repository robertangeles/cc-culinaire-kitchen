#!/usr/bin/env node
/**
 * Smoke test for POST /api/auth/google/idtoken (mobile native sign-in).
 *
 * Verifies the endpoint exists, accepts the documented request shape,
 * rejects invalid input correctly, and reaches the Google ID token
 * verification step (which we then expect to fail with INVALID_ID_TOKEN
 * since we're sending a fake token).
 *
 * Does NOT verify a real ID token end-to-end — that requires a real
 * Google account, the Google Cloud Console Android client ID provisioned,
 * and a real signed-in mobile session. For real e2e, run the mobile app
 * against this backend and tap "Continue with Google".
 *
 * Usage:
 *   node scripts/smoke-test-google-idtoken.mjs [BASE_URL]
 *
 * Examples:
 *   node scripts/smoke-test-google-idtoken.mjs                          # localhost:3009
 *   node scripts/smoke-test-google-idtoken.mjs http://localhost:3009
 *   node scripts/smoke-test-google-idtoken.mjs https://api.example.com
 */

const baseUrl = process.argv[2] || "http://localhost:3009";
const endpoint = `${baseUrl.replace(/\/$/, "")}/api/auth/google/idtoken`;

let pass = 0;
let fail = 0;

function ok(name) {
  console.log(`  ✓ ${name}`);
  pass++;
}

function notOk(name, expected, actual) {
  console.log(`  ✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`);
  fail++;
}

async function check(name, fn) {
  try {
    await fn();
  } catch (err) {
    notOk(name, "no error", err.message);
  }
}

console.log(`\nSmoke testing ${endpoint}\n`);

await check("rejects missing body with 400", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status === 400) {
    ok("rejects missing body with 400");
  } else {
    notOk("rejects missing body with 400", 400, res.status);
  }
});

await check("rejects missing idToken field with 400", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notTheRightField: "x" }),
  });
  if (res.status === 400) {
    ok("rejects missing idToken field with 400");
  } else {
    notOk("rejects missing idToken field with 400", 400, res.status);
  }
});

await check("rejects empty idToken string with 400", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "" }),
  });
  if (res.status === 400) {
    ok("rejects empty idToken string with 400");
  } else {
    notOk("rejects empty idToken string with 400", 400, res.status);
  }
});

await check("rejects fake idToken with 401 (verification fails)", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "this.is.not-a-real-jwt" }),
  });
  // Two acceptable outcomes:
  //   401 INVALID_ID_TOKEN  → server has Google client IDs configured + tried verify
  //   500 OAUTH_NOT_CONFIGURED → server has no Google client IDs (set GOOGLE_CLIENT_ID
  //                              or GOOGLE_ANDROID_CLIENT_ID and re-run)
  if (res.status === 401) {
    ok("rejects fake idToken with 401 (verification fails)");
  } else if (res.status === 500) {
    const body = await res.json().catch(() => ({}));
    if (body.error?.includes("not configured")) {
      console.log(
        "  ! server returned 500 OAUTH_NOT_CONFIGURED — set GOOGLE_CLIENT_ID or " +
          "GOOGLE_ANDROID_CLIENT_ID in .env and restart the server, then re-run.",
      );
      // Don't count as fail; it's a config issue, not a code bug.
      pass++;
    } else {
      notOk("rejects fake idToken with 401", 401, `${res.status} ${JSON.stringify(body)}`);
    }
  } else {
    notOk("rejects fake idToken with 401", 401, res.status);
  }
});

await check("returns JSON content-type", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    ok("returns JSON content-type");
  } else {
    notOk("returns JSON content-type", "application/json", ct);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail > 0) {
  process.exit(1);
}
