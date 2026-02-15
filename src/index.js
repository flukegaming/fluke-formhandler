export default {
  async fetch(request) {
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

    if (request.method === 'POST') {
      try {
        const data = await request.json();
        return Response.json({
          success: true,
          message: 'Raid signup received!',
          data
        }, { headers: corsHeaders });
      } catch {
        return Response.json({ success: false, message: 'Invalid data' }, { 
          status: 400, headers: corsHeaders 
        });
      }
    }

    return Response.json({ success: false, message: 'POST only' }, { 
      status: 405, headers: corsHeaders 
    });
  }
};