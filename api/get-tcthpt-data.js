// Vercel API route — proxy sang Apps Script lấy dữ liệu sheet tc_thpt (nhóm S)
const TCTHPT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzKaXJfwHknKqZJ0aJRFomT83kCaSTTUuLkKg2Hj6WgrDfgDHfjKuNTQ5WQ48lL9Mqp/exec';

const CACHE_TTL_MS = 2 * 60 * 1000;
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
    const url = TCTHPT_APPS_SCRIPT_URL + '?sheet=tc_thpt';
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!response.ok) throw new Error('Apps Script HTTP ' + response.status);

    const json = await response.json();

    let rawRows = [];
    let headers = [];

    if (json.success && json.sheets) {
      const sheet = json.sheets.find(s => s.sheetName === 'tc_thpt') || json.sheets[0];
      if (sheet && sheet.data && sheet.data.length > 0) {
        headers = sheet.data[0];
        rawRows = sheet.data.slice(1);
      }
    }

    if (!rawRows.length) {
      _cache = { ok: true, total: 0, data: [], headers: [], generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) };
      _cacheTime = now;
      return res.status(200).json(_cache);
    }

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

    function get(row, idx) { return idx >= 0 ? String(row[idx] || '').trim() : ''; }

    // Sheet tc_thpt columns: username | final_name | final_phone | final_email | paid_time | type | exam | Mã bảo mật | name_group_aim | link_group_aim | Trạng thái duyệt AIM | Thời gian duyệt AIM | Người duyệt AIM
    const idxUsername   = colIdx(['username', 'user']);
    const idxFinalName  = colIdx(['final_name', 'tên', 'ten']);
    const idxSdt        = colIdx(['final_phone', 'phone', 'sđt', 'sdt']);
    const idxEmail      = colIdx(['final_email', 'email', 'mail']);
    const idxType       = colIdx(['type', 'loai']);
    const idxExam       = colIdx(['exam', 'kỳ thi', 'ky_thi']);
    const idxMabaomat   = colIdx(['mã bảo mật', 'ma_bao_mat', 'mabaomat', 'mabaomats']);
    const idxTenGroup   = colIdx(['tên group cộng đồng', 'tên group', 'name_group_aim', 'ten_group', 'group name']);
    const idxLinkGroup  = colIdx(['link group cộng đồng', 'link group', 'link_group_aim', 'link_group', 'group link']);
    const idxDuyet      = colIdx(['trạng thái duyệt aim', 'trạng thái duyệt', 'trang_thai_duyet', 'status']);
    const idxTGDuyet    = colIdx(['thời gian duyệt aim', 'thời gian duyệt', 'thoi_gian_duyet', 'tg_duyet']);
    const idxNguoiDuyet = colIdx(['người duyệt aim', 'người duyệt', 'nguoi_duyet']);

    const data = rawRows.map(row => ({
      username:        get(row, idxUsername),
      final_name:      get(row, idxFinalName),
      sdt:             get(row, idxSdt),
      email:           get(row, idxEmail),
      type:            get(row, idxType),
      exam:            get(row, idxExam),
      mabaomat:        get(row, idxMabaomat),
      ten_group:       get(row, idxTenGroup),
      link_group:      get(row, idxLinkGroup),
      trang_thai_duyet: get(row, idxDuyet),
      tg_duyet:        get(row, idxTGDuyet),
      nguoi_duyet:     get(row, idxNguoiDuyet),
    }));

    _cache = {
      ok: true,
      total: data.length,
      data,
      headers: headers,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    };
    _cacheTime = now;
    return res.status(200).json(_cache);

  } catch (err) {
    console.error('get-tcthpt-data error:', err.message);
    return res.status(200).json({
      ok: true, total: 0, data: [], headers: [],
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      error: 'Không thể tải dữ liệu tc_thpt: ' + err.message,
    });
  }
};