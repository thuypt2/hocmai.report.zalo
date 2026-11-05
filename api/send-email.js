// Vercel API route — proxy sang Apps Script gửi email cho tab 2.2
// Hỗ trợ action: send_selected (gửi email hàng loạt từ danh sách chọn)

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxbezQjKSkXGXfWEGaTu1Y7rXdLUzfAPqtA9rQ7EJnWuV5ilD4bz3XbhNTJHxl4t-CKug/exec';
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

// Tên giải pháp / sản phẩm của 1 học sinh — dùng cho biến {{ $json.product_name }}
// (và {{tengiaiphap}} kiểu cũ). Không bao giờ trả rỗng để email không bị câu cụt.
function resolveProductName(s) {
  const direct = String((s && (s.product_name || s.san_pham || s.ten_giai_phap)) || '').trim();
  if (direct) return direct;
  const t = String((s && (s.type || s._type)) || '').trim().toUpperCase();
  if (t === 'S') return 'HOCMAI TopUni 2027 - Lộ trình S';
  if (t === 'A') return 'HOCMAI TopUni 2027 - Lộ trình A';
  if (t === 'TC') return 'HOCMAI TopUni 2027 - Lộ trình Tiêu chuẩn';
  if (t === 'VIP') return 'HOCMAI TopUni 2027 - Lộ trình VIP';
  const exam = String((s && (s.exam || s._exam)) || '').trim();
  if (exam) return 'HOCMAI TopUni 2027 - ' + exam;
  const lop = String((s && s._ma_lop) || '').trim();
  if (lop) return 'HOCMAI TopUni 2027 - ' + lop;
  return 'HOCMAI TopUni 2027';
}

// Tab 3.1 gửi theo BATCH: chỉ render được biến ĐỒNG NHẤT cho cả nhóm.
// {{ $json.product_name }} → tên sản phẩm của nhóm; {{ $json.username }} → đổi về
// {{username}} để Apps Script render theo từng học sinh (AS đã có key 'username').
function renderBatchBody(tpl, productName) {
  return String(tpl || '')
    .replace(/{{\s*\$json\.product_name\s*}}/gi, productName)
    .replace(/{{\s*tengiaiphap\s*}}/gi, productName)
    .replace(/{{\s*\$json\.username\s*}}/gi, '{{username}}');
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

    if (templateBody && templateBody.length < 500 && !templateBody.includes('<') && (templateBody.includes('/') || templateBody.endsWith('.txt') || templateBody.endsWith('.html'))) {
    console.log('[send-email] templateBody looks like a path, returning error to client to force local resolution');
    return res.status(400).json({ ok: false, error: 'Dữ liệu template chưa được load nội dung (đang là path). Hãy nhấn "Xem mẫu" trước khi gửi.' });
  }

  // Mẫu "Hướng dẫn nhận sách Luyện đề" dùng biến kiểu n8n {{ $json.product_name }} /
  // {{ $json.username }}. Tab 3.1 gửi theo BATCH nên tên sản phẩm phải đồng nhất
  // trong 1 lần gọi → nhóm học sinh theo tên sản phẩm rồi gọi Apps Script mỗi nhóm 1 lần.
  // (Các mẫu cũ không có 2 biến này nên chỉ còn đúng 1 nhóm → hành vi như trước.)

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

    // Gom nhóm theo tên sản phẩm đã resolve (thường chỉ 1 nhóm)
    const groups = new Map();
    for (const s of uniqueStudents) {
      const name = resolveProductName(s);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(s);
    }
    if (groups.size > 1) {
      console.log('[send-email] chia batch theo product_name:', [...groups.keys()].join(' | '));
    }

    let sentTotal = 0;
    let errTotal = 0;
    const sentIds = [];
    const errDetails = [];
    let lastResult = { ok: true };

    for (const [productName, group] of groups) {
      const body = renderBatchBody(templateBody, productName);
      // Gọi Apps Script: sendClassGroupEmails với danh sách email cụ thể + template
      // QUAN TRỌNG: truyền limit = số lượng unique để Apps Script gửi hết
      // (mặc định AS chỉ gửi 200 nếu không có limit — user chọn 300-500 sẽ bị cắt)
      const r = await callAppsScript({
        action: 'sendClassGroupEmails',
        secret: APPS_SCRIPT_SECRET,
        limit: group.length,  // gửi hết danh sách đã chọn (tối đa do UI giới hạn 500)
        templateKey: templateKey,
        templateSubject: templateSubject,
        templateBody: body,
        selectedEmails: group.map(s => s.email),
        selectedStudents: group,
      });
      lastResult = r;
      if (!r || r.ok === false) { errTotal += group.length; errDetails.push({ product_name: productName, error: (r && r.error) || 'unknown' }); continue; }
      sentTotal += r.sent || 0;
      errTotal += r.errors || 0;
      if (Array.isArray(r.sent_ids)) sentIds.push(...r.sent_ids);
      if (Array.isArray(r.error_details)) errDetails.push(...r.error_details);
    }

    const result = {
      ok: true,
      sent: sentTotal,
      errors: errTotal,
      sent_ids: sentIds,
      error_details: errDetails,
      log_ids: lastResult && lastResult.log_ids,
    };

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
