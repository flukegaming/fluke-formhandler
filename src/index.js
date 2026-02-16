export default {
  async fetch(req, env) {
    if (req.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }

    const data = [
      new Date().toISOString(),
      "Test Player",
      "Tank",
      "Test notes"
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
      } catch (err) {
        appendStatus = `failed: ${err.message}`;
      }

      // 2️⃣ send success email
      try {
        await sendEmail(env, "Raid Form Submission Success", `Row added: ${JSON.stringify(data)}`);
        emailStatus = "success";
      } catch (err) {
        emailStatus = `failed: ${err.message}`;
      }

      return new Response(
        JSON.stringify({ appendStatus, emailStatus }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );

    } catch (err) {
      // fallback in case getGoogleAccessToken itself fails
      return new Response(
        JSON.stringify({ appendStatus, emailStatus, error: err.message }, null, 2),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
};

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
  // Check required secrets/vars
  if (
    !env.ZOHO_CLIENT_ID ||
    !env.ZOHO_CLIENT_SECRET ||
    !env.ZOHO_OAUTH_REFRESH_TOKEN ||
    !env.ZOHO_ACCOUNT_ID ||
    !env.ZOHO_EMAIL_SENDER ||
    !env.ZOHO_EMAIL_RECIPIENT
  ) {
    console.warn("Zoho email not fully configured, skipping sendEmail()");
    return;
  }

  try {
    // 1️⃣ Get a short-lived access token from refresh token
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

    // 2️⃣ Send email via Zoho Mail REST API
    const apiUrl = `https://mail.zoho.com/api/accounts/${env.ZOHO_ACCOUNT_ID}/messages`;

    const zohoSender = env.ZOHO_EMAIL_SENDER.trim();
    const zohoRecipient = env.ZOHO_EMAIL_RECIPIENT.trim();

    const payload = {
      fromAddress: zohoSender,
      toAddress: [zohoRecipient],
      subject,
      content: body,
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Zoho email failed:", text);
    } else {
      console.log(`Zoho email sent: ${subject}`);
    }
  } catch (err) {
    console.error("sendEmail() error:", err);
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