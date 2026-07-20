const WAIT_MEMBER_API_URL =
  'https://script.google.com/macros/s/AKfycbwtPmnT_Q_WSzgH9VrH3LwW3PrIL9-p35VVTuADjcHnmHIadv6g4E2miRqQKs002_x2Nw/exec';

// Sheet chứa học sinh chờ duyệt kết nối — tên chính xác từ your Google Sheet
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút cache
let _cache = null;
let _cacheTime = 0;

function formatWaitDate(dateStr) {
  if (!dateStr) return '';
  let m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  m = dateStr.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (m) return m[1] + '/' + m[2] + '/' + m[3];
  m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return dateStr;
}

// Try multiple header names + fallback index positions to extract a field
function getField(item, names, fallbackIndices) {
  // 1. Try header names (case-insensitive, trimmed)
  const headerKeys = Object.keys(item);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[_\s]+/g, '');
    for (const key of headerKeys) {
      const normalizedKey = key.toLowerCase().replace(/[_\s]+/g, '');
      if (normalizedKey === normalized && item[key]) {
        return String(item[key]).trim();
      }
    }
  }
  // 2. Try fallback column labels (A, B, C, ...)
  for (const idx of fallbackIndices || []) {
    const colLabel = String.fromCharCode(65 + idx); // 0→A, 1→B, ...
    if (item[colLabel]) return String(item[colLabel]).trim();
  }
  // 3. Try numeric array indices (if data comes as array)
  for (const idx of fallbackIndices || []) {
    const val = item[idx];
    if (val != null && val !== '') return String(val).trim();
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Check cache
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_cache);
  }
  res.setHeader('X-Cache', 'MISS');

  try {
    const url = WAIT_MEMBER_API_URL + '?action=getAllSpreadsheetData&sheet=waiting_member';
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!response.ok) {
      throw new Error('Apps Script HTTP ' + response.status);
    }

    const json = await response.json();

    if (!json.ok) {
      return res.status(200).json({
        ok: true,
        generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        total: 0,
        data: [],
        error: json.error || 'Apps Script chưa hỗ trợ sheet=waiting_member.',
      });
    }

    // Format data từ sheet Waiting_member
    // Apps Script ver8 trả về TẤT CẢ cột raw → proxy map ở đây
    const formattedData = (json.data || []).map((item, idx) => {
      // Extract Group_id & Zalo_id (required by Flow 7 accept-members API)
      // Try header: "Group_id", "group_id", "ID Group", "Group ID"
      // Fallback cột A(0), C(2)
      const group_id = getField(item,
        ['Group_id', 'group_id', 'GroupID', 'groupid', 'ID Group', 'Group ID', 'Id group'],
        [0, 2]
      );
      const zalo_id = getField(item,
        ['Zalo_id', 'zalo_id', 'ZaloID', 'zaloid', 'UID', 'uid', 'Zalo UID', 'User ID'],
        [0, 2, 5]
      );

      return {
        stt: idx + 1,
        exam: getField(item, ['exam', 'Exam', 'Kỳ thi', 'Ky thi', 'I'], [8]),
        ma_lop: getField(item, ['Group_name', 'Group Name', 'GroupName', 'Mã lớp', 'ma_lop'], [1]),
        ten_zalo: getField(item, ['Display Name', 'Displayname', 'DisplayName', 'ten_zalo'], [3]),
        avatar: getField(item, ['Avatar', 'avatar'], [4]),
        ngay_yeu_cau: formatWaitDate(
          getField(item, ['Wait At', 'wait at', 'Wait at', 'WaitAt', 'ngay_yeu_cau'], [6])
        ),
        group_id: group_id,
        zalo_id: zalo_id,
      };
    });

    _cache = {
      ok: true,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      total: formattedData.length,
      data: formattedData,
    };
    _cacheTime = now;

    return res.status(200).json(_cache);

  } catch (err) {
    console.error('get-wait-members error:', err.message);
    return res.status(200).json({
      ok: true,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      total: 0,
      data: [],
      error: 'Không thể tải dữ liệu wait_member: ' + err.message + '. Vui lòng kiểm tra sheet có tên chính xác là "Wait_member" trong Google Sheets bạn cung cấp cho Apps Script.',
    });
  }
};
