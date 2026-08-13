// Vercel API route — proxy sang Apps Script gửi email nhóm S (tab 2.2 sub-s-group + tab 2.3 tc-thpt)
// QUAN TRỌNG: Vercel resolve template content (đọc từ MAIN sheet Email_Templates + file api/templates/)
// rồi POST templateBody đã resolve xuống S-Group Apps Script.
// Không để Apps Script tự fetch Vercel (UrlFetchApp không ổn định).

const fs = require('fs');
const path = require('path');
const { fetchGET } = require('./_lib/fetch-gapps');

const SGROUP_APPS_SCRIPT_URL = process.env.SGROUP_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzKaXJfwHknKqZJ0aJRFomT83kCaSTTUuLkKg2Hj6WgrDfgDHfjKuNTQ5WQ48lL9Mqp/exec';
const MAIN_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxQKeHZ37tSLjtOoTzJjXZeRYGfSXvIeNUFMxcqFZpRkEOyu6ciwpD6oTwhm2eRbDuqDA/exec';
const IMAGE_URL = 'https://hocmai-report-zalo.vercel.app/huong-dan-vao-aim.png';
const TEMPLATES_DIR = path.join(__dirname, 'templates');

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// Resolve html_body: nếu là path file, đọc nội dung từ api/templates/
function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';
  const trimmed = htmlBody.trim();
  if (!(/[\\\\/]/.test(trimmed) || trimmed.endsWith('.txt'))) return trimmed;
  const filename = trimmed.replace(/[\\\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
    console.warn('Template file not found:', filePath);
  } catch (e) {
    console.error('Error reading template:', filePath, e.message);
  }
  return trimmed;
}

// Lấy template từ sheet Email_Templates của MAIN spreadsheet qua Apps Script
async function getResolvedTemplate(templateKey) {
  const url = MAIN_APPS_SCRIPT_URL + '?action=getAllSpreadsheetData&sheet=Email_Templates';
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

// POST JSON tới S-Group Apps Script, xử lý redirect manual (Google 302: script.google.com → script.googleusercontent.com)
async function postToSGroup(payload) {
  const body = JSON.stringify(payload);

  // POST lần 1 — có thể nhận 302 redirect
  let resp = await fetch(SGROUP_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body,
    redirect: 'manual',
  });

  // Nếu redirect, POST lại tới URL đích (giữ nguyên method + body)
  if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
    resp = await fetch(resp.headers.get('location'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
    });
  }

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Apps Script không trả JSON: ' + text.slice(0, 300));
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const rawBody = await readBody(req);
    let body = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }

    const { email, username, linknhom, link_group, mabaomats, link_aim, templateKey } = body;
    if (!email) return res.status(400).json({ ok: false, error: 'Thiếu email' });

    // Resolve template trên Vercel (đọc từ MAIN sheet Email_Templates + file api/templates/)
    const tmpl = await getResolvedTemplate(templateKey || 'SSC:HDAIM-S');

    // POST resolved template xuống S-Group Apps Script
    const result = await postToSGroup({
      action: 'sendIndividualEmail',
      secret: '@Hocmai123',
      templateKey: templateKey || 'SSC:HDAIM-S',
      templateSubject: tmpl.subject,
      templateBody: tmpl.htmlBody,
      email: email,
      username: username || '',
      linknhom: linknhom || link_group || '',
      mabaomats: mabaomats || '',
      link_aim: link_aim || '',
      imageUrl: IMAGE_URL,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}