// Vercel API route — proxy sang Apps Script gửi email
// Hỗ trợ: (1) Individual send từ tab 2.2  (2) Batch send từ form quản trị
//
// QUAN TRỌNG: Vercel resolve template content (đọc file từ api/templates/)
// rồi truyền templateBody xuống Apps Script — Apps Script chỉ render + gửi.
// Không để Apps Script tự fetch (không ổn định, fallback ra raw path).

const fs = require('fs');
const path = require('path');
const { fetchGET } = require('./_lib/fetch-gapps');

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxv2T-koDfgQIiyqMTCTcOUT_H0d5857UNBqbx_CNoyz8axOH-c8DTpa_HesQgD5tQ1Zg/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
const APPS_SCRIPT_TIMEOUT = 240000; // 4 phút timeout cho Apps Script
const TEMPLATES_DIR = path.join(__dirname, 'templates');

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

// Resolve html_body: nếu là path file (Windows/Linux), đọc nội dung từ api/templates/
function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';
  const trimmed = htmlBody.trim();
  if (!(/[\\/]/.test(trimmed) || trimmed.endsWith('.txt'))) return trimmed;
  const filename = trimmed.replace(/[\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
    console.warn('Template file not found:', filePath);
  } catch (e) {
    console.error('Error reading template:', filePath, e.message);
  }
  return trimmed;
}

// Lấy template từ sheet Email_Templates qua Apps Script (metadata + html_body raw),
// rồi resolve nội dung trên Vercel
async function getResolvedTemplate(templateKey) {
  const url = APPS_SCRIPT_URL + '?action=getAllSpreadsheetData&sheet=Email_Templates';
  const json = await fetchGET(url);
  if (!json.ok || !Array.isArray(json.data)) {
    throw new Error('Không đọc được Email_Templates: ' + (json.error || 'no data'));
  }
  const rows = json.data;
  const headers = Object.keys(rows[0] || {});
  function colIdx(names) {
    for (const n of names) {
      const nn = n.toLowerCase().replace(/[\s_]+/g, '');
      for (const k of headers) {
        if (k.toLowerCase().replace(/[\s_]+/g, '') === nn && rows[0][k] !== undefined) return k;
      }
    }
    return null;
  }
  const keyK = colIdx(['template_key', 'templatekey', 'key', 'ma_mau']);
  const subjectK = colIdx(['subject', 'chu_de', 'ten_mau']);
  const bodyK = colIdx(['html_body', 'htmlbody', 'noi_dung_html']);
  const activeK = colIdx(['active']);

  const row = rows.find(r => {
    if (String(r[keyK] || '').trim() !== templateKey) return false;
    if (activeK && String(r[activeK] || '').trim().toUpperCase() !== 'TRUE') return false;
    return true;
  });
  if (!row) throw new Error('Không tìm thấy template key="' + templateKey + '"');

  return {
    subject: String(row[subjectK] || ''),
    htmlBody: resolveTemplateContent(String(row[bodyK] || '')),
  };
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

    // ===== Individual send (resolve template trên Vercel rồi truyền xuống) =====
    if (isIndividual) {
      const { email, username, ma_lop, exam, gv, link_group,
              sdt_gv, ma_bao_mat, nhom_aim, link_aim, final_phone,
              tencongdong, linknhom, mabaomats } = body;

      let templateSubject = '';
      let templateBody = '';

      // Nếu client đã truyền sẵn nội dung (từ tab 3), dùng luôn
      if (body.templateBody) {
        templateSubject = body.templateSubject || '';
        templateBody = body.templateBody;
      } else {
        // Ngược lại, resolve từ sheet qua Apps Script + đọc file trên Vercel
        const tmpl = await getResolvedTemplate(body.templateKey || 'SSC:HD130');
        templateSubject = tmpl.subject;
        templateBody = tmpl.htmlBody;
      }

      // Dùng sendClassGroupEmails + selectedStudents (cơ chế useCustomTemplate)
      // — bản Apps Script deploy hiện tại ĐÃ hỗ trợ, không cần redeploy.
      const student = {
        email, username, ma_lop, exam, gv, link_group,
        sdt_gv, ma_bao_mat, nhom_aim, link_aim, final_phone,
        tencongdong, linknhom, mabaomats,
      };

      const result = await callAppsScript({
        action: 'sendClassGroupEmails',
        secret: APPS_SCRIPT_SECRET,
        templateKey: body.templateKey || 'SSC:HD130',
        templateSubject,
        templateBody,
        selectedEmails: [email],
        selectedStudents: [student],
      });

      return res.status(200).json(result);
    }

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}