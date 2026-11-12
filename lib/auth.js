const crypto = require("node:crypto");

const SESSION_COOKIE = "webdev_app_session";
const OAUTH_COOKIE = "nalar_oauth_nonce";
const SESSION_SECONDS = 8 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;

function authError(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw authError("Login belum dikonfigurasi pada server.", 503);
  return value;
}

function parseCookies(header = "") {
  const cookies = Object.create(null);
  for (const item of String(header).split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = "";
    }
  }
  return cookies;
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left || ""));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function cookieHeader(name, value, { secure, maxAge, httpOnly = true } = {}) {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `SameSite=${secure ? "None" : "Lax"}`,
  ];
  if (secure) pieces.push("Secure");
  if (httpOnly) pieces.push("HttpOnly");
  if (Number.isFinite(maxAge)) pieces.push(`Max-Age=${Math.trunc(maxAge)}`);
  return pieces.join("; ");
}

function clearCookie(name, secure) {
  const pieces = [
    `${name}=`,
    "Path=/",
    `SameSite=${secure ? "None" : "Lax"}`,
    "Max-Age=0",
    "HttpOnly",
  ];
  if (secure) pieces.push("Secure");
  return pieces.join("; ");
}

function validateBrowserOrigin(input, requestOrigin) {
  let parsed;
  try {
    parsed = new URL(String(input || ""));
  } catch {
    throw authError(
      "Alamat login tidak valid. Muat ulang halaman dan coba lagi.",
      400,
    );
  }
  const origin = parsed.origin;
  const localHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    origin === "null" ||
    parsed.username ||
    parsed.password ||
    (!origin.startsWith("https://") && !localHttp) ||
    String(input) !== origin
  ) {
    throw authError("Alamat login tidak diizinkan.", 400);
  }
  // Preview can replace the browser Origin with an opaque or loopback proxy origin.
  // Keep the browser-supplied HTTPS origin strictly validated above; reject any
  // visible non-local mismatch rather than deriving a redirect from internal Host.
  if (requestOrigin && requestOrigin !== origin) {
    let proxyOrigin = requestOrigin === "null";
    try {
      const forwarded = new URL(requestOrigin);
      proxyOrigin ||=
        forwarded.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
          forwarded.hostname,
        );
    } catch {
      // Opaque or malformed proxy origins cannot identify the browser origin.
    }
    if (!proxyOrigin)
      throw authError("Asal permintaan login tidak cocok.", 403);
  }
  return { origin, secure: parsed.protocol === "https:" };
}

function loginAvailable() {
  return Boolean(
    process.env.MANUS_PROJECT_ID &&
      process.env.MANUS_OAUTH_PORTAL_URL &&
      process.env.MANUS_OAUTH_API_URL &&
      process.env.MANUS_JWT_SECRET &&
      process.env.NALARAI_OWNER_EMAIL,
  );
}

function createOAuthStart(originInput, requestOrigin) {
  if (!loginAvailable())
    throw authError("Login pemilik belum lengkap dikonfigurasi.", 503);
  const { origin, secure } = validateBrowserOrigin(originInput, requestOrigin);
  const redirectUri = `${origin}/`;
  const nonce = crypto.randomBytes(32).toString("base64url");
  const state = Buffer.from(
    JSON.stringify({ redirectUri, nonce }),
    "utf8",
  ).toString("base64");
  const portal = new URL(
    "app-auth",
    `${process.env.MANUS_OAUTH_PORTAL_URL.replace(/\/+$/, "")}/`,
  );
  portal.searchParams.set("appId", process.env.MANUS_PROJECT_ID);
  portal.searchParams.set("redirectUri", redirectUri);
  portal.searchParams.set("state", state);
  portal.searchParams.set("responseType", "code");
  return {
    url: portal.toString(),
    cookie: cookieHeader(OAUTH_COOKIE, nonce, {
      secure,
      maxAge: OAUTH_SECONDS,
    }),
  };
}

function decodeOAuthState(stateValue) {
  if (typeof stateValue !== "string" || stateValue.length > 4096)
    throw authError("State login tidak valid. Mulai login kembali.", 400);
  try {
    const parsed = JSON.parse(
      Buffer.from(stateValue, "base64").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 32 ||
      parsed.nonce.length > 128
    ) {
      throw new Error("invalid state");
    }
    return parsed;
  } catch {
    throw authError("State login tidak valid. Mulai login kembali.", 400);
  }
}

async function oauthPost(pathname, payload) {
  const apiBase = process.env.MANUS_OAUTH_API_URL;
  if (!apiBase) throw authError("Login Manus belum tersedia.", 503);
  let response;
  try {
    response = await fetch(
      `${apiBase.replace(/\/+$/, "")}/webdev.v1.WebDevAuthPublicService/${pathname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      },
    );
  } catch {
    throw authError(
      "Layanan login Manus sementara tidak dapat dihubungi.",
      502,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error)
    throw authError("Verifikasi akun Manus gagal. Coba masuk kembali.", 401);
  return data;
}

function subjectDigest(openId) {
  const key = requiredEnv("MANUS_JWT_SECRET");
  return crypto
    .createHmac("sha256", key)
    .update("nalarai-owner-subject\0")
    .update(openId)
    .digest();
}

function ownerIdFromDigest(digest) {
  const bytes = Buffer.from(digest).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function issueSession(openId, secure) {
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      appId: requiredEnv("MANUS_PROJECT_ID"),
      openId,
      iat: now,
      exp: now + SESSION_SECONDS,
      csrf: csrfToken,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", requiredEnv("MANUS_JWT_SECRET"))
    .update(unsigned)
    .digest("base64url");
  return {
    csrfToken,
    cookie: cookieHeader(SESSION_COOKIE, `${unsigned}.${signature}`, {
      secure,
      maxAge: SESSION_SECONDS,
    }),
  };
}

function verifySession(token) {
  if (typeof token !== "string" || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header?.alg !== "HS256" || header?.typ !== "JWT") return null;
  let expected;
  try {
    expected = crypto
      .createHmac("sha256", requiredEnv("MANUS_JWT_SECRET"))
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
  } catch {
    return null;
  }
  let supplied;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (!safeEqual(expected, supplied)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims?.appId !== process.env.MANUS_PROJECT_ID ||
    typeof claims.openId !== "string" ||
    claims.openId.length < 1 ||
    claims.openId.length > 512 ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 60 ||
    typeof claims.csrf !== "string" ||
    claims.csrf.length < 32 ||
    claims.csrf.length > 128
  ) {
    return null;
  }
  return claims;
}

async function findOwner(req, pool) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const claims = verifySession(token);
  if (!claims)
    throw authError("Sesi tidak berlaku. Masuk kembali dengan akun pemilik.");
  const digest = subjectDigest(claims.openId);
  const [rows] = await pool.execute(
    "SELECT subject_hash FROM owner_identity WHERE id = 1 LIMIT 1",
  );
  if (!rows.length || !safeEqual(Buffer.from(rows[0].subject_hash), digest))
    throw authError("Akun ini tidak terdaftar sebagai pemilik Nalar.", 403);
  return { ownerId: ownerIdFromDigest(digest), claims };
}

function requireCsrf(req, claims) {
  if (!safeEqual(req.headers["x-csrf-token"], claims.csrf))
    throw authError(
      "Sesi keamanan tidak cocok. Muat ulang halaman dan coba lagi.",
      403,
    );
}

async function completeOAuth({ body, req, pool }) {
  if (!loginAvailable())
    throw authError("Login pemilik belum lengkap dikonfigurasi.", 503);
  const { origin, secure } = validateBrowserOrigin(
    body.origin,
    req.headers.origin,
  );
  const state = decodeOAuthState(body.state);
  const expectedRedirect = `${origin}/`;
  const nonceCookie = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
  if (
    state.redirectUri !== expectedRedirect ||
    !nonceCookie ||
    !safeEqual(state.nonce, nonceCookie)
  ) {
    throw authError(
      "Verifikasi keamanan login gagal. Mulai login kembali.",
      403,
    );
  }
  const code = String(body.code || "");
  if (!code || code.length > 2048)
    throw authError("Kode login tidak valid. Mulai login kembali.", 400);
  const exchanged = await oauthPost("ExchangeToken", {
    clientId: requiredEnv("MANUS_PROJECT_ID"),
    grantType: "authorization_code",
    code,
    redirectUri: expectedRedirect,
  });
  const accessToken = exchanged.accessToken;
  if (typeof accessToken !== "string" || !accessToken)
    throw authError(
      "Layanan login Manus tidak mengembalikan token yang valid.",
      401,
    );
  const user = await oauthPost("GetUserInfo", { accessToken });
  const openId = typeof user.openId === "string" ? user.openId : "";
  const email =
    typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const allowedEmail = requiredEnv("NALARAI_OWNER_EMAIL").trim().toLowerCase();
  if (!openId || openId.length > 512 || !email || email !== allowedEmail)
    throw authError("Akun Manus ini tidak diizinkan mengakses Nalar.", 403);

  const digest = subjectDigest(openId);
  await pool.execute(
    "INSERT IGNORE INTO owner_identity (id, subject_hash) VALUES (1, ?)",
    [digest],
  );
  const [rows] = await pool.execute(
    "SELECT subject_hash FROM owner_identity WHERE id = 1 LIMIT 1",
  );
  if (!rows.length || !safeEqual(Buffer.from(rows[0].subject_hash), digest))
    throw authError("Identitas pemilik Nalar sudah terikat ke akun lain.", 403);

  const session = issueSession(openId, secure);
  return {
    csrfToken: session.csrfToken,
    cookie: session.cookie,
    clearNonce: clearCookie(OAUTH_COOKIE, secure),
    ownerId: ownerIdFromDigest(digest),
  };
}

function logoutCookie(req) {
  const origin = req.headers.origin || req.headers.referer || "";
  let secure = true;
  try {
    secure = new URL(origin).protocol === "https:";
  } catch {
    // Default to Secure for public HTTPS Preview.
  }
  return clearCookie(SESSION_COOKIE, secure);
}

module.exports = {
  SESSION_COOKIE,
  OAUTH_COOKIE,
  loginAvailable,
  createOAuthStart,
  completeOAuth,
  findOwner,
  requireCsrf,
  logoutCookie,
  parseCookies,
};
