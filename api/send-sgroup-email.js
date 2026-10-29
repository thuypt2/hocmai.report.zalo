// Vercel API route — gửi email nhóm S (tab 2.2 sub-s-group + tab 2.3 tc-thpt)
// Dùng sendClassGroupEmails + selectedStudents (giống send-class-group-email.js, đã hỗ trợ templateBody).
// Vercel resolve template trước, rồi POST templateBody đã resolve xuống MAIN Apps Script.

const fs = require('fs');
const path = require('path');
const { fetchGET, fetchPOST } = require('./_lib/fetch-gapps');

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxbezQjKSkXGXfWEGaTu1Y7rXdLUzfAPqtA9rQ7EJnWuV5ilD4bz3XbhNTJHxl4t-CKug/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
const IMAGE_URL = 'https://hocmai-report-zalo.vercel.app/huong-dan-vao-aim.png';
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Cache Email_Templates: tránh gọi Apps Script 2 lần (Google rate-limit từ Vercel IP)
const _TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 phút
let _templateCache = null;
let _templateCacheTime = 0;

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

function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';
  const trimmed = htmlBody.trim();
  // Bỏ dấu chấm thừa cuối (lỗi nhập liệu: "file.txt.") trước khi detect path
  const clean = trimmed.replace(/\.+$/, '');
  if (!(/[\\/]/.test(clean) || /\.(txt|html|htm)$/i.test(clean))) return trimmed;
  const filename = clean.replace(/[\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {}
  return trimmed;
}

function appendImageGuide(htmlBody) {
  if (!htmlBody) return htmlBody;
  const imageBlock = '<br><br><div style="text-align:center;margin-top:16px">' +
    '<p style="font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px"><b>Hướng dẫn vào nhóm AIM:</b></p>' +
    '<img src="' + IMAGE_URL + '" alt="Hướng dẫn vào AIM" style="max-width:600px;width:100%;border-radius:8px;border:1px solid #e5e7eb">' +
    '</div>';
  const bodyCloseIdx = htmlBody.lastIndexOf('</body>');
  if (bodyCloseIdx >= 0) return htmlBody.slice(0, bodyCloseIdx) + imageBlock + htmlBody.slice(bodyCloseIdx);
  return htmlBody + imageBlock;
}

async function getResolvedTemplate(templateKey) {
  const now = Date.now();
  let rows;
  if (_templateCache && (now - _templateCacheTime) < _TEMPLATE_CACHE_TTL) {
    rows = _templateCache;
  } else {
    const url = APPS_SCRIPT_URL + '?action=getAllSpreadsheetData&sheet=Email_Templates';
    const json = await fetchGET(url);
    if (!json.ok || !Array.isArray(json.data)) {
      throw new Error('Không đọc được Email_Templates: ' + (json.error || 'no data'));
    }
    rows = json.data;
    _templateCache = rows;
    _templateCacheTime = now;
  }

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

// Gọi Apps Script POST — dùng https.request() (tránh Google security block với fetch())
// QUAN TRỌNG: KHÔNG retry (attempts=99 vô hiệu hóa retry trong fetchPOST).
// Gửi email KHÔNG idempotent — nếu Apps Script đã gửi email thành công nhưng response
// bị Google rate-limit trả HTML, retry sẽ GỬI LẠI EMAIL (bug "mỗi email bị gửi 3 lần").
// Retry chỉ an toàn cho thao tác đọc (GET).
async function callAppsScript(payload) {
  try {
    return await fetchPOST(APPS_SCRIPT_URL, payload, 99);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Gói học của học sinh: 'S' hoặc 'A' — dùng cho placeholder {{lo_trinh}} và tiêu đề email.
// Ưu tiên body.type (cột J sheet users), sau đó tên nhóm AIM, cuối cùng là mã bảo mật.
function resolveLoTrinh(body) {
  const t = String(body.type || '').trim().toUpperCase();
  if (t === 'A' || t === 'S') return t;
  const g = String(body.ten_group_aim || '').trim().toUpperCase();
  if (/^HOCMAI\s+A\b/.test(g) || /\bA\s+(HSA|TSA|V-ACT|QDA)\b/.test(g)) return 'A';
  const ma = String(body.mabaomats || '').trim().toUpperCase();
  if (/^A\d/.test(ma)) return 'A';
  return 'S';
}

// Tiêu đề trong sheet Email_Templates đang ghi "...Nhóm AIM S..." — với gói A đổi thành AIM A
// để email khớp đúng gói học sinh nhận. Bắt cả biến thể "Nhóm AIM S" và "AIM S".
function subjectForLoTrinh(subject, loTrinh) {
  const s = String(subject || '');
  if (loTrinh !== 'A') return s;
  return s.replace(/\bAIM\s+S\b/gi, (m) => m.replace(/S$/i, 'A'));
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

    const { email, username, linknhom, link_group, mabaomats, link_aim, exam, ten_group_aim, templateKey, templateSubject, templateBody, type, class: klass } = body;
    if (!email) return res.status(400).json({ ok: false, error: 'Thiếu email' });

    // Gói học sinh: S hay A — quyết định {{lo_trinh}} trong nội dung + "AIM S/A" trong tiêu đề
    const loTrinh = resolveLoTrinh(body);

    // Resolve template trên Vercel: nếu client đã gửi templateBody sẵn (đã resolve),
    // dùng luôn. Ngược lại resolve theo templateKey.
    let tmpl;
    if (templateBody) {
      tmpl = { subject: templateSubject || '', htmlBody: templateBody };
    } else {
      tmpl = await getResolvedTemplate(templateKey || 'SSC:HDAIM-S');
    }
    tmpl.subject = subjectForLoTrinh(tmpl.subject, loTrinh);
    // Render luôn {{lo_trinh}} ở Vercel (giá trị đã biết theo từng học sinh) để email
    // không bao giờ lộ placeholder, kể cả khi Apps Script chưa cập nhật mapping mới.
    tmpl.htmlBody = String(tmpl.htmlBody || '').replace(/{{\s*lo_trinh\s*}}/gi, loTrinh);

    // Thêm ảnh hướng dẫn AIM
    const htmlBodyWithImage = appendImageGuide(tmpl.htmlBody);

    const student = {
      email, username,
      linknhom: linknhom || link_group || '',
      mabaomats: mabaomats || '',
      link_aim: link_aim || '',
      exam: exam || '',
      ten_group_aim: ten_group_aim || '',
      type: type || '',
      class: klass || '',
      lo_trinh: loTrinh,
    };

    const result = await callAppsScript({
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