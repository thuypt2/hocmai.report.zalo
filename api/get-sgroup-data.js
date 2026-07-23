// Vercel API route — proxy sang Apps Script lấy dữ liệu nhóm S (sheet users)
const SGROUP_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxmqBq0z2jOoLqfETe5uWPyT71y-9-jrjQSOUZq4vjvQkn5dAU1gg-yzIN6Fmb4rfKG/exec';

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 phút cache
let _cache = null;
let _cacheTime = 0;

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

  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_cache);
  }
  res.setHeader('X-Cache', 'MISS');

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(SGROUP_APPS_SCRIPT_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!response.ok) {
      throw new Error('Apps Script HTTP ' + response.status);
    }

    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch {
      return res.status(200).json({ ok: true, total: 0, data: [], generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
    }

    // Apps Script có thể trả về { ok, data } hoặc mảng trực tiếp
    const rawData = json.ok ? json.data : (Array.isArray(json) ? json : (json.data || []));
    if (!Array.isArray(rawData)) {
      return res.status(200).json({ ok: true, total: 0, data: [], generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
    }

    // Map dữ liệu từ sheet users:
    // A=Username, B=UserID, C=SĐT, D=Email, F=product, J=mabaomat, L=link nhóm, M=maillan1, S=noti, X=Trạng thái duyệt
    const data = rawData.map(row => {
      const get = (col) => {
        // Thử key dạng chữ cái trước (A, B, C...), sau đó thử index (0, 1, 2...)
        const letter = String.fromCharCode(65 + col);
        if (row[letter] != null) return String(row[letter]).trim();
        if (row[col] != null) return String(row[col]).trim();
        // Fallback: tìm theo tên field thông dụng
        const colMap = {
          0: ['username', 'Username', 'USERNAME', 'user'],
          1: ['userid', 'UserID', 'USERID', 'user_id'],
          2: ['sđt', 'SĐT', 'sdt', 'SDT', 'phone', 'Phone', 'PHONE'],
          3: ['email', 'Email', 'EMAIL', 'mail'],
          5: ['product', 'Product', 'PRODUCT'],
          9: ['mabaomat', 'Mabaomat', 'ma_bao_mat', 'Mã bảo mật'],
          11: ['link nhóm', 'link_nhom', 'Link nhóm', 'link group'],
          12: ['maillan1', 'MailLan1', 'mail_lan1'],
          18: ['noti', 'Noti', 'NOTI'],
          23: ['trang_thai_duyet', 'Trạng thái duyệt', 'trang thai duyet', 'status'],
        };
        const names = colMap[col] || [];
        for (const n of names) {
          if (row[n] != null) return String(row[n]).trim();
        }
        return '';
      };
      return {
        username: get(0),
        userid: get(1),
        sdt: get(2),
        email: get(3),
        product: get(5),
        mabaomat: get(9),
        link_nhom: get(11),
        maillan1: get(12),
        noti: get(18),
        trang_thai_duyet: get(23),
      };
    });

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
      ok: true,
      total: 0,
      data: [],
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      error: 'Không thể tải dữ liệu nhóm S: ' + err.message,
    });
  }
};
