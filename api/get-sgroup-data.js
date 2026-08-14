// Vercel API route — proxy sang Apps Script lấy dữ liệu nhóm S (sheet users)
const { fetchGET } = require('./_lib/fetch-gapps');

// ── AIM link mapping theo tên nhóm AIM (nhóm S) ────────────────────────────────
// Map bằng tên chuẩn hóa (lowercase, bỏ ký tự đặc biệt). Nếu cần sửa link,
// chỉ chỉnh bảng này.
const AIM_LINK_MAP = [
  // HSA
  { key: 'hsa',  link: 'https://hocmai.link/HSAaim100plus' },
  // V-ACT
  { key: 'vact', link: 'https://hocmai.link/VACTaim900plus' },
  // TSA / QDA / TN-THPT (dự phòng cho tương lai)
  { key: 'tsa',      link: 'https://hocmai.link/TSAaim70plus' },
  { key: 'qda',      link: 'https://hocmai.link/QDAaim100plus' },
  { key: 'tnthpt',   link: 'https://hocmai.link/TNTHPTaim25plus' },
];
function resolveAimLink(groupName) {
  // Chuẩn hóa: lowercase + bỏ mọi ký tự không phải chữ số để 'v-act' thành 'vact', '900 plus' -> '900plus'
  const g = String(groupName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const m of AIM_LINK_MAP) {
    if (g.includes(m.key)) return m.link;
  }
  return ''; // không match → rỗng (email bỏ link)
}

const SGROUP_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzKaXJfwHknKqZJ0aJRFomT83kCaSTTUuLkKg2Hj6WgrDfgDHfjKuNTQ5WQ48lL9Mqp/exec';

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 phút cache
let _cache = null;
let _cacheTime = 0;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_cache);
  }
  res.setHeader('X-Cache', 'MISS');

  try {
    const json = await fetchGET(SGROUP_APPS_SCRIPT_URL);

    // Format mới: { success, sheets: [{ sheetName: "users", data: [[headers],[row1],...] }] }
    // Format cũ: { ok, data: [...] }
    let rawRows = [];
    let headers = [];

    if (json.success && json.sheets) {
      const sheet = json.sheets.find(s => s.sheetName === 'users') || json.sheets[0];
      if (sheet && sheet.data && sheet.data.length > 0) {
        headers = sheet.data[0];  // dòng đầu là header
        rawRows = sheet.data.slice(1);  // các dòng còn lại là data
      }
    } else if (json.ok && Array.isArray(json.data)) {
      rawRows = json.data;
    } else if (Array.isArray(json)) {
      rawRows = json;
    }

    if (!rawRows.length) {
      // Không cache kết quả rỗng để tránh màn hình trắng kéo dài khi Google rate-limit
      return res.status(200).json({ ok: true, total: 0, data: [], generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
    }

    // Map: dùng tên header để tìm vị trí cột (không phụ thuộc thứ tự)
    function colIdx(names) {
      for (const n of names) {
        const idx = headers.findIndex(h => {
          const hn = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
          const nn = n.toLowerCase().replace(/[\s_]+/g, '');
          return hn === nn;
        });
        if (idx >= 0) return idx;
      }
      return -1;
    }

    const idxUsername = colIdx(['username', 'user']);
    const idxUserid   = colIdx(['student_hmid', 'userid', 'user_id']);
    const idxSdt      = colIdx(['phone', 'sđt', 'sdt']);
    const idxEmail    = colIdx(['email', 'mail']);
    const idxProduct  = colIdx(['product_id', 'product']);
    const idxMabaomat = colIdx(['mabaomats', 'mabaomat', 'ma_bao_mat']);
    const idxLinknhom = colIdx(['linknhom', 'link_nhom', 'link nhóm', 'link group']);
    const idxMaillan1 = colIdx(['maillan1', 'mail_lan1']);
    const idxNoti     = colIdx(['trạng thái bắn noti', 'noti']);
    const idxDuyet    = colIdx(['trạng thái duyệt', 'trang_thai_duyet', 'status']);

    // Sheet users columns (theo vị trí thật):
    //   H = exam, K = Tên nhóm AIM
    // Ưu tiên map theo tên header; nếu không tìm thấy, fallback THEO VỊ TRÍ CỘT
    const idxExam     = colIdx(['exam', 'kỳ thi', 'ky_thi', 'kythi']);
    const idxTenGroup  = colIdx(['tên nhóm aim', 'name_group_aim', 'ten_group_aim', 'ten nhom aim', 'tên group cộng đồng', 'ten_group']);
    const posExamIdx   = (headers.length > 7)  ? 7  : -1;  // cột H (index 7)
    const posTenGroupIdx = (headers.length > 10) ? 10 : -1; // cột K (index 10)
    const effectiveExam    = idxExam    >= 0 ? idxExam    : posExamIdx;
    const effectiveTenGroup = idxTenGroup >= 0 ? idxTenGroup : posTenGroupIdx;

    function get(row, idx) { return idx >= 0 ? String(row[idx] || '').trim() : ''; }

    const data = rawRows.map(row => ({
      username: get(row, idxUsername),
      userid: get(row, idxUserid),
      sdt: get(row, idxSdt),
      email: get(row, idxEmail),
      product: get(row, idxProduct),
      mabaomat: get(row, idxMabaomat),
      link_nhom: get(row, idxLinknhom),
      maillan1: get(row, idxMaillan1),
      noti: get(row, idxNoti),
      trang_thai_duyet: get(row, idxDuyet),
      exam: get(row, effectiveExam),
      ten_group_aim: get(row, effectiveTenGroup),
      link_aim: resolveAimLink(get(row, effectiveTenGroup)),
    }));

    _cache = {
      ok: true,
      total: data.length,
      data,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    };
    _cacheTime = now;
    return res.status(200).json(_cache);

  } catch (err) {
    console.error('get-sgroup-data error:', err.message);
    return res.status(200).json({
      ok: true, total: 0, data: [],
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      error: 'Không thể tải dữ liệu nhóm S: ' + err.message,
    });
  }
};
