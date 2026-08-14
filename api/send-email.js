// Vercel API route — proxy sang Apps Script gửi email cho tab 2.2
// Hỗ trợ action: send_selected (gửi email hàng loạt từ danh sách chọn)

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxv2T-koDfgQIiyqMTCTcOUT_H0d5857UNBqbx_CNoyz8axOH-c8DTpa_HesQgD5tQ1Zg/exec';
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

    const { action, templateKey, templateSubject, templateBody, students } = body;

    // ── Dừng khẩn cấp gửi email hàng loạt ──
    if (action === 'stop' || action === 'resume' || action === 'status') {
      const asAction = action === 'stop' ? 'stopEmailBatch'
        : action === 'resume' ? 'resumeEmailBatch' : 'emailBatchStopStatus';
      const result = await callAppsScript({
        action: asAction,
        secret: APPS_SCRIPT_SECRET,
      });
      return res.status(200).json(result);
    }

    if (action !== 'send_selected') {
      return res.status(400).json({ ok: false, error: 'action không hợp lệ' });
    }

    if (!students || !students.length) {
      return res.status(400).json({ ok: false, error: 'Không có học sinh để gửi' });
    }

    // ── Dedup theo email: 1 email → chỉ gửi 1 lần (giữ row đầu tiên) ──
    // Dữ liệu nguồn trả 1 row/học sinh/lớp đã join → học sinh trong nhiều nhóm
    // sẽ có nhiều row cùng email. Tránh gửi N email trùng (bug "gửi thành 3 email").
    const seen = new Set();
    const uniqueStudents = [];
    for (const s of students) {
      const e = String((s && s.email) || '').trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      uniqueStudents.push(s);
    }
    const deduped = students.length - uniqueStudents.length;
    if (deduped > 0) {
      console.log(`[send-email] dedup ${deduped} row trùng email (${seen.size} unique)`);
    }

    // Gọi Apps Script: sendClassGroupEmails với danh sách email cụ thể + template
    const result = await callAppsScript({
      action: 'sendClassGroupEmails',
      secret: APPS_SCRIPT_SECRET,
      templateKey: templateKey,
      templateSubject: templateSubject,
      templateBody: templateBody,
      selectedEmails: uniqueStudents.map(s => s.email),
      selectedStudents: uniqueStudents,
    });

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
