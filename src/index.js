export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return corsResponse(JSON.stringify({}), req, 204);
    }

    if (req.method !== "POST") {
      return corsResponse(JSON.stringify({ error: "POST only" }), req, 405);
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    // 2026-02-16 04:56:42

    const signup = await req.json();
    const data = [
      timestamp,
      signup.Season || '',
      signup.Name || '',
      signup.MainClass || '',
      signup.MainSpec || '',
      signup.MainOffspec || '',
      signup.AltClass || '',
      signup.AltSpec || '',
      signup.AltOffspec || '',
      signup.Comments || ''
    ];

    let appendStatus = "not attempted";
    let emailStatus = "not attempted";

    try {
      const tokenJson = await getGoogleAccessToken(env);
      const token = tokenJson.access_token;

      // 1️⃣ append row
      try {
        await appendRow(token, env, "signup_data", data);
        appendStatus = "success";

        // 2️⃣ send success email
        try {
          await sendEmail(env, "Raid Form Submission Success", `Row added: ${JSON.stringify(data)}`);
          emailStatus = "success";
        } catch (err) {
          emailStatus = `failed: ${err.message}`;
        }

      } catch (appendErr) {
        appendStatus = `failed: ${appendErr.message}`;

        // Send failure email if append failed
        try {
          await sendEmail(
            env,
            "Raid Form Submission Failed",
            `Row append failed: ${appendErr.message}\nData attempted: ${JSON.stringify(data)}`
          );
          emailStatus = "failure email sent";
        } catch (emailErr) {
          emailStatus = `failed to send failure email: ${emailErr.message}`;
        }
      }

      return corsResponse(JSON.stringify({ appendStatus, emailStatus }), req);

    } catch (err) {
      // fallback in case getGoogleAccessToken itself fails
      return corsResponse(JSON.stringify({ appendStatus: "failed", emailStatus: "failed", error: err.message }), req, 500);
    }
  }
};

// -------------------------
// corsResponse header
// -------------------------
const ALLOWED_ORIGINS = [
  "https://flukegaming.com",
  "https://test.flukegaming.com"
];

function corsResponse(body, req, status = 200) {
  const origin = req.headers.get("Origin");
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(body, { status, headers });
}

// -------------------------
// Google Auth
// -------------------------
async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing service account secrets");
  }

  const privateKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const enc = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsigned = `${enc(header)}.${enc(claim)}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  return tokenRes.json();
}

// -------------------------
// Append Row
// -------------------------
async function appendRow(token, env, tab, values) {
  if (!env.GOOGLE_SHEETS_ID) throw new Error("Missing spreadsheet ID");

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}/values/${tab}!A2:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [values] }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets append failed: ${text}`);
  }
}

// -------------------------
// Zoho Email (REST)
// -------------------------
async function sendEmail(env, subject, body) {
  if (
    !env.ZOHO_CLIENT_ID ||
    !env.ZOHO_CLIENT_SECRET ||
    !env.ZOHO_OAUTH_REFRESH_TOKEN ||
    !env.ZOHO_ACCOUNT_ID ||
    !env.ZOHO_EMAIL_SENDER ||
    !env.ZOHO_EMAIL_RECIPIENT
  ) {
    throw new Error("Zoho email not fully configured, skipping sendEmail()");
  }

  try {
    const tokenParams = new URLSearchParams({
      refresh_token: env.ZOHO_OAUTH_REFRESH_TOKEN,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token",
    });

    const tokenRes = await fetch(`https://accounts.zoho.com/oauth/v2/token?${tokenParams.toString()}`, {
      method: "POST",
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Failed to get Zoho access token");

    const accessToken = tokenData.access_token;

    const payload = {
      fromAddress: env.ZOHO_EMAIL_SENDER.trim(),
      toAddress: env.ZOHO_EMAIL_RECIPIENT.trim(),
      subject,
      content: body,
    };

    const res = await fetch(`https://mail.zoho.com/api/accounts/${env.ZOHO_ACCOUNT_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zoho email failed: ${text}`);
    }

    return await res.json();
  } catch (err) {
    throw new Error(`sendEmail() error: ${err.message || err}`);
  }
}

// -------------------------
// PEM → ArrayBuffer
// -------------------------
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}