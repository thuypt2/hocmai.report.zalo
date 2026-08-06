// Vercel API route — proxy sang Apps Script gửi email
// Hỗ trợ: (1) Individual send từ tab 2.2  (2) Batch send từ form quản trị

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbyl0pjYwfE0IfiAyV952BTUSeV75yTmXjGgImTrskVVLNtOp608ZNRyc97ZZR6kF5_gOg/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
const APPS_SCRIPT_TIMEOUT = 240000; // 4 phút timeout cho Apps Script

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
    const resp = await fetch(APPS_SCRIPT_URL, {
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
    const { limit, email, username, ma_lop, exam, gv, link_group } = body;

    const isBatch = !email;
    const isIndividual = !!email;

    if (!isBatch && !isIndividual) {
      return res.status(400).json({
        ok: false,
        error: 'Thiếu tham số',
      });
    }

    // ===== Batch send =====
    if (isBatch) {
      const result = await callAppsScript({
        action: 'sendClassGroupEmails',
        secret: APPS_SCRIPT_SECRET,
        limit: Number(limit || 50),
      });

      return res.status(200).json(result);
    }

    // ===== Individual send =====
    if (isIndividual) {
      const { email, username, ma_lop, exam, gv, link_group,
              sdt_gv, ma_bao_mat, nhom_aim, link_aim, final_phone,
              tencongdong, linknhom, mabaomats } = body;
      const result = await callAppsScript({
        action: 'sendIndividualEmail',
        secret: APPS_SCRIPT_SECRET,
        templateKey: body.templateKey || '',
        email,
        username,
        ma_lop,
        exam,
        gv,
        link_group,
        sdt_gv:      sdt_gv      || '',
        ma_bao_mat:  ma_bao_mat  || '',
        nhom_aim:    nhom_aim    || '',
        link_aim:    link_aim    || '',
        final_phone: final_phone || '',
        tencongdong: tencongdong || '',
        linknhom:    linknhom    || '',
        mabaomats:   mabaomats   || '',
      });

      return res.status(200).json(result);
    }

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
