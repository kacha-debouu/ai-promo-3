/**
 * Site-wide password gate for the ai-promo-3 gallery preview.
 *
 * This is a Cloudflare Pages Function. The root `_middleware.js` runs on
 * EVERY request (including every static asset) before the file is served,
 * so the whole site sits behind a single shared password.
 *
 * Configure in the Pages project →  Settings → Variables and Secrets:
 *   SITE_PASSWORD   (required — add as an *encrypted* Secret)  the shared password
 *   SITE_USER       (optional — plaintext is fine)            username, default "widelab"
 *
 * Visitors get the browser's native Basic-Auth prompt. Until SITE_PASSWORD
 * is set the site stays closed (503) so nothing is ever exposed by accident.
 * The password itself is never committed to the repo — it lives only as a
 * Cloudflare secret.
 */
export const onRequest = async ({ request, env, next }) => {
  const password = env.SITE_PASSWORD;

  // Fail closed: no password configured → don't expose anything.
  if (!password) {
    return new Response("Preview password is not configured yet.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const user = env.SITE_USER || "widelab";
  const header = request.headers.get("Authorization") || "";

  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { decoded = ""; }
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      const u = decoded.slice(0, sep);
      const p = decoded.slice(sep + 1);
      if (u === user && timingSafeEqual(p, password)) {
        return next(); // authenticated → serve the requested file
      }
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ai-promo-3 preview", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
};

// Constant-time string compare to avoid leaking length/early-exit timing.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
