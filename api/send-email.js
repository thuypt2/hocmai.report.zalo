// Vercel API route — proxy sang Apps Script gửi email cho tab 2.2
// Hỗ trợ action: send_selected (gửi email hàng loạt từ danh sách chọn)

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbyl0pjYwfE0IfiAyV952BTUSeV75yTmXjGgImTrskVVLNtOp608ZNRyc97ZZR6kF5_gOg/exec';
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

// Follow redirects manually, preserving POST method & body
async function postWithRedirect(url, bodyStr, maxHops = 5) {
  let currentUrl = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);
    try {
      const resp = await fetch(currentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyStr,
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const status = resp.status;
      if (status === 301 || status === 302 || status === 307 || status === 308) {
        const loc = resp.headers.get('location');
        if (!loc) throw new Error('Redirect without Location header');
        currentUrl = new URL(loc, currentUrl).href;
        continue;
      }

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
      throw e;
    }
  }
  return { ok: false, error: 'Quá nhiều redirect (max ' + maxHops + ')' };
}

async function callAppsScript(payload) {
  return postWithRedirect(APPS_SCRIPT_URL, JSON.stringify(payload));
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

    const { action, templateKey, templateSubject, templateBody, students } = body;

    if (action !== 'send_selected') {
      return res.status(400).json({ ok: false, error: 'action không hợp lệ' });
    }

    if (!students || !students.length) {
      return res.status(400).json({ ok: false, error: 'Không có học sinh để gửi' });
    }

    // Gọi Apps Script: sendClassGroupEmails với danh sách email cụ thể + template
    const result = await callAppsScript({
      action: 'sendClassGroupEmails',
      secret: APPS_SCRIPT_SECRET,
      templateKey: templateKey,
      templateSubject: templateSubject,
      templateBody: templateBody,
      selectedEmails: students.map(s => s.email),
      selectedStudents: students,
    });

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
