// Vercel API route — proxy accept-members request to Flow 7 server
// POST /api/accept-members
// Body: { members: [{ Group_id, Zalo_id, Group_name?, "Display Name"?, Avatar?, ... }] }
// Proxy to: POST http://103.82.26.244:3007/accept-members

const FLOW7_ACCEPT_URL = 'http://103.82.26.244:3007/accept-members';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Read body
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch (parseErr) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON body: ' + parseErr.message });
    }

    if (!body.members || !Array.isArray(body.members) || body.members.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Thiếu members array. Body cần có: { "members": [{ "Group_id": "...", "Zalo_id": "..." }] }',
      });
    }

    // Validate từng member: phải có Group_id và Zalo_id
    const sanitized = [];
    for (const m of body.members) {
      const groupId = String(m.Group_id || m.group_id || '').trim();
      const zaloId = String(m.Zalo_id || m.zalo_id || '').trim();
      if (!groupId || !zaloId) {
        return res.status(400).json({
          ok: false,
          error: 'Mỗi member cần có Group_id và Zalo_id (dạng string). Member thiếu: ' + JSON.stringify(m).slice(0, 200),
        });
      }
      // Force string type (Flow 7 API yêu cầu string, không phải number)
      sanitized.push({
        Group_id: groupId,
        Zalo_id: zaloId,
        Group_name: m.Group_name || m.group_name || m['Group Name'] || '',
        'Display Name': m['Display Name'] || m.display_name || '',
        Avatar: m.Avatar || m.avatar || '',
        'User Submit': m['User Submit'] || m.User_Submit || '',
        'Wait At': m['Wait At'] || m.wait_at || '',
      });
    }

    // Forward to Flow 7 server
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 60000);

    const fwd = await fetch(FLOW7_ACCEPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: sanitized }),
      signal: controller.signal,
    });
    clearTimeout(tid);

    const result = await fwd.json();

    // Luôn trả HTTP 200 cho browser (Flow 7 có thể trả 200 hoặc non-200)
    return res.status(200).json(result);

  } catch (err) {
    console.error('accept-members error:', err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Flow 7 server timeout (60s)' });
    }
    return res.status(502).json({
      ok: false,
      error: 'Không kết nối được tới Flow 7 server: ' + err.message,
    });
  }
}
