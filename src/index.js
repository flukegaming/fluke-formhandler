export default {
  async fetch(req, env) {
    try {
      if (req.method !== "POST") {
        return new Response("POST only", { status: 405 });
      }

      // Example payload — in real use, pull from req.json()
      const newRow = [
        new Date().toISOString(),
        "Test Player",
        "Tank",
        "Test notes"
      ];

      // Get access token (reuse your working function)
      const token = await getGoogleAccessToken(env);

      // Append row to sheet
      const sheetName = "signup_data";
      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}/values/${sheetName}!A2:append?valueInputOption=USER_ENTERED`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ values: [newRow] })
        }
      );

      if (!appendRes.ok) {
        const text = await appendRes.text();
        return new Response(`Append failed: ${text}`, { status: 500 });
      }

      return new Response("Row appended successfully!");
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  }
};

// === HELPER FUNCTIONS ===
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

  // import key for signing
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