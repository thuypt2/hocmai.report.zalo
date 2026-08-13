// Vercel API route — gửi email nhóm S (tab 2.2 sub-s-group + tab 2.3 tc-thpt)
// Dùng sendClassGroupEmails + selectedStudents (giống send-class-group-email.js, đã hỗ trợ templateBody).
// Vercel resolve template trước, rồi POST templateBody đã resolve xuống MAIN Apps Script.
// Dùng https.request() thay vì fetch() để tránh bị Google security chặn.

const fs = require('fs');
const path = require('path');
const { fetchGET, fetchPOST } = require('./_lib/fetch-gapps');

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxQKeHZ37tSLjtOoTzJjXZeRYGfSXvIeNUFMxcqFZpRkEOyu6ciwpD6oTwhm2eRbDuqDA/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
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

// Thêm ảnh hướng dẫn AIM vào cuối template (trước </body>)
function appendImageGuide(htmlBody) {
  if (!htmlBody) return htmlBody;
  const imageBlock = '<br><br><div style="text-align:center;margin-top:16px">' +
    '<p style="font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px"><b>Hướng dẫn vào nhóm AIM:</b></p>' +
    '<img src="' + IMAGE_URL + '" alt="Hướng dẫn vào AIM" style="max-width:600px;width:100%;border-radius:8px;border:1px solid #e5e7eb">' +
    '</div>';
  const bodyCloseIdx = htmlBody.lastIndexOf('</body>');
  if (bodyCloseIdx >= 0) {
    return htmlBody.slice(0, bodyCloseIdx) + imageBlock + htmlBody.slice(bodyCloseIdx);
  }
  return htmlBody + imageBlock;
}

// Lấy template từ sheet Email_Templates của MAIN spreadsheet qua Apps Script
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

    // Resolve template trên Vercel
    const tmpl = await getResolvedTemplate(templateKey || 'SSC:HDAIM-S');

    // Thêm ảnh hướng dẫn AIM
    const htmlBodyWithImage = appendImageGuide(tmpl.htmlBody);

    // Gửi qua MAIN Apps Script: sendClassGroupEmails + selectedStudents (dùng https.request)
    const student = {
      email, username,
      linknhom: linknhom || link_group || '',
      mabaomats: mabaomats || '',
      link_aim: link_aim || '',
    };

    const result = await fetchPOST(APPS_SCRIPT_URL, {
      action: 'sendClassGroupEmails',
      secret: APPS_SCRIPT_SECRET,
      templateKey: templateKey || 'SSC:HDAIM-S',
      templateSubject: tmpl.subject,
      templateBody: htmlBodyWithImage,
      selectedEmails: [email],
      selectedStudents: [student],
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}