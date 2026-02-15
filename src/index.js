export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = [
      'https://test.flukegaming.com',
      'https://flukegaming.com'
    ];
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return Response.json({ success: false, message: 'POST only' }, { 
        status: 405, headers: corsHeaders 
      });
    }

    // main form data handling
    try {
      const formData = await request.json();
      
      await insertSheetRow(formData, env);
      await sendRaidEmail(formData, env);
      
      return Response.json({ 
        success: true, 
        message: 'Added to sheet + email sent!'
      }, { headers: corsHeaders });
      
    } catch (error) {
      console.error('Worker error:', error);

      try {
        await sendErrorEmail(request, error);
      } catch (emailError) {
        console.error('Failed to send error email:', emailError);
      }

      return Response.json({ 
        success: false, 
        message: 'Server error: ' + error.message 
      }, { status: 500, headers: corsHeaders });
    }
  }
};

async function insertSheetRow(data, env) {
  const SHEET_ID = env.SHEETS_ID; // Worker env var
  const SHEET_NAME = 'test_data';
  const token = await createGoogleJWT(env);

  // STEP 1: Insert EMPTY row BELOW header (row 2)
  const insertResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: {
              sheetId: 0,
              dimension: 'ROWS',
              startIndex: 1,
              endIndex: 2
            },
            inheritFromBefore: false
          }
        }]
      })
    }
  );
  
  if (!insertResponse.ok) {
    throw new Error(`Insert failed: ${insertResponse.status}`);
  }

  const values = [
    new Date().toISOString(),
    data.Season || '',
    data.Name || '',
    data.MainClass || '',
    data.MainSpec || '',
    data.MainOffspec || '',
    data.AltClass || '',
    data.AltSpec || '',
    data.AltOffspec || '',
    data.Comments || ''
  ];

  // STEP 2: Write data to the NEW row 2
  const updateResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F2?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [values]
      })
    }
  );
  
  if (!updateResponse.ok) {
    throw new Error(`Update failed: ${updateResponse.status}`);
  }
}

async function sendRaidEmail(data, env) {
  const token = await createGoogleJWT(env);
  
  const subject = `New Raid Signup: ${data.Season || 'N/A'} - ${data.Name || 'Unnamed'} (${data.MainClass || 'No class'})`;
  const body = `
New raid signup received!

Season: ${data.Season || 'N/A'}
Name: ${data.Name || 'N/A'}
MainClass: ${data.MainClass || 'N/A'}
MainSpec: ${data.MainSpec || 'N/A'}
MainOffspec: ${data.MainOffspec || 'N/A'}
AltClass: ${data.AltClass || 'N/A'}
AltSpec: ${data.AltSpec || 'N/A'}
AltOffspec: ${data.AltOffspec || 'N/A'}
Comments: ${data.Comments || 'None'}

Status: ✅ Successfully added to raid sheet
  `;
  
  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      raw: btoa(`From: Raid Bot <no-reply@flukegaming.com>
To: flukegaming57@gmail.com
Subject: ${subject}

${body}`)
    })
  });
}

async function sendErrorEmail(request, error, env) {
  const token = await createGoogleJWT(env);
  
  const errorData = await request.json().catch(() => ({}));
  const subject = 'Raid Form Failure - ' + new Date().toISOString();
  const body = `
RAID FORM SUBMISSION FAILED!

Time: ${new Date().toISOString()}
Error: ${error.message || 'Unknown error'}
URL: ${request.url}
User Agent: ${request.headers.get('User-Agent') || 'Unknown'}
Origin: ${request.headers.get('Origin') || 'Unknown'}

Form Data (if received):
${JSON.stringify(errorData, null, 2)}

Stack (if available):
${error.stack || 'No stack trace'}
  `;
  
  await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      raw: btoa(`From: Raid Bot <no-reply@flukegaming.com>
To: flukegaming57@gmail.com
Subject: ${subject}

${body}`)
    })
  });
}

async function createGoogleJWT(env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.SERVICE_ACCOUNT_EMAIL, // Worker env var
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  
  const encoded = btoa(JSON.stringify(header)) + '.' + btoa(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', 
    await crypto.subtle.importKey('pkcs8', 
      new Uint8Array(atob(env.PRIVATE_KEY).split('').map(c => c.charCodeAt(0))), // Worker env var
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']
    ),
    new TextEncoder().encode(encoded)
  );
  
  const jwt = encoded + '.' + btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  
  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}