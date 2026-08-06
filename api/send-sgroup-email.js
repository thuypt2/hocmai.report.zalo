// Vercel API route — proxy sang Apps Script gửi email nhóm S (tab 2.2)
// Tránh lỗi cross-origin POST redirect của browser → Apps Script

const SGROUP_APPS_SCRIPT_URL = process.env.SGROUP_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzcPffmv3R6VxI_TSnv3-05TcmvASc9T7LxL3jbD3uJ15D7BNou0lPwAbfnL4v0PYJf/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
const APPS_SCRIPT_TIMEOUT = 240000; // 4 phút timeout

// Config Vercel serverless
export const config = {
  api: {
    bodyParser: false,
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function callAppsScript(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);

  try {
    const resp = await fetch(SGROUP_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: 'Apps Script trả về không phải JSON', raw: text.slice(0, 500) };
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { ok: false, error: 'Apps Script timeout (>4 phút)' };
    }
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const rawBody = await readBody(req);
    let body = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }

    const { email, username, linknhom, mabaomats, link_aim, templateKey } = body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Thiếu email' });
    }

    // Gọi Apps Script: sendIndividualEmail với đầy đủ params
    const result = await callAppsScript({
      action: 'sendIndividualEmail',
      secret: APPS_SCRIPT_SECRET,
      templateKey: templateKey || 'SSC:HDAIM-S',
      email,
      username: username || '',
      linknhom: linknhom || '',
      link_aim: link_aim || '',
      mabaomats: mabaomats || '',
    });

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
