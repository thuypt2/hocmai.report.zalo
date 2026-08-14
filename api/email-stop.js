// Vercel API route — Dừng khẩn cấp gửi email hàng loạt
// POST /api/email-stop  { action: 'stop' | 'resume' | 'status' }
//   stop   → set cờ STOP trong Apps Script (CacheService) → các loop batch dừng sau email hiện tại
//   resume → xóa cờ (cho phép gửi tiếp nếu cần)
//   status → kiểm tra cờ hiện tại
//
// Lưu ý: Apps Script loop check cờ mỗi vòng → 1 email đang gửi sẽ gửi xong rồi mới dừng
// (không hủy giữa chừng email đang gửi dở).

const { fetchPOST } = require('./_lib/fetch-gapps');

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxQKeHZ37tSLjtOoTzJjXZeRYGfSXvIeNUFMxcqFZpRkEOyu6ciwpD6oTwhm2eRbDuqDA/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';

// Config Vercel serverless
export const config = {
  api: { bodyParser: false },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let action = 'status';
    if (req.method === 'POST') {
      const rawBody = await readBody(req);
      let body = {};
      try { body = JSON.parse(rawBody); } catch { body = {}; }
      action = body.action || 'status';
      if (req.query && req.query.action) action = req.query.action;
    } else {
      action = (req.query && req.query.action) || 'status';
    }

    if (!['stop', 'resume', 'status'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'action không hợp lệ (stop/resume/status)' });
    }

    const asAction = action === 'stop' ? 'stopEmailBatch'
      : action === 'resume' ? 'resumeEmailBatch' : 'emailBatchStopStatus';

    const result = await fetchPOST(APPS_SCRIPT_URL, {
      action: asAction,
      secret: APPS_SCRIPT_SECRET,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}