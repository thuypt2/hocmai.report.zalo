// Vercel API route — gọi TopUni2 data API + tính KPI
// Được gọi bởi browser khi load BaoCaoDuyetZalo_v7.html
// Trả về: { ok, generated_at, total_rows, exam_stats, monthly_chart, weekly_chart,
//            all_months, all_weeks_per_exam, top20_130, top20_aim, group_summary,
//            hsa_pie, exams, groups_by_exam, lookup }

const TOPUNI2_DATA_API_URL =
  process.env.TOPUNI2_DATA_API_URL || 'https://onboard-topuni.hocmai.io.vn/api/topuni2-data';
const TOPUNI2_DATA_API_SECRET = process.env.TOPUNI2_DATA_API_SECRET || '';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút cache trong memory (tránh gọi API liên tục)
let _cache = null;
let _cacheTime = 0;

async function fetchTopuni2Rows() {
  const headers = { 'User-Agent': 'BaocaoduyetZalo/1.0' };
  if (TOPUNI2_DATA_API_SECRET) {
    headers.Authorization = `Bearer ${TOPUNI2_DATA_API_SECRET}`;
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 180000);

  try {
    const resp = await fetch(TOPUNI2_DATA_API_URL, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    const text = await resp.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`TopUni2 data API trả về không phải JSON: ${text.slice(0, 200)}`);
    }

    if (!resp.ok || !payload.ok) {
      throw new Error(payload.error || `TopUni2 data API HTTP ${resp.status}`);
    }
    if (!Array.isArray(payload.data)) {
      throw new Error('TopUni2 data API thiếu field data dạng array');
    }

    return payload.data;
  } finally {
    clearTimeout(tid);
  }
}

// ---- helpers ----
function s(row, key) {
  const v = row[key];
  if (v == null) return '';
  return String(v).trim();
}

function paidMonth(v) {
  if (!v) return null;
  const str = String(v).trim();
  // YYYY-MM-DD ... hoặc DD/MM/YYYY
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const yr = parseInt(m[1], 10);
    return yr >= 2000 ? `${m[1]}-${m[2]}` : null;
  }
  m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const yr = parseInt(m[3], 10);
    return yr >= 2000 ? `${m[3]}-${m[2]}` : null;
  }
  return null;
}

function weekLabel(row) {
  const wp = String(row['weekpaid'] || '').trim();
  if (wp && wp.toUpperCase().startsWith('W')) return wp;
  // fallback: tính từ paid_time
  const pt = String(row['paid_time'] || '').trim();
  const dm = pt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return null;
  const d = new Date(`${dm[1]}-${dm[2]}-${dm[3]}`);
  if (isNaN(d)) return null;
  // ISO week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.round((d - jan4) / 86400000) + jan4.getDay();
  const wn = Math.ceil(dayOfYear / 7);
  return `W${String(wn).padStart(2, '0')} (${d.getFullYear()})`;
}

function isCHUYEN_DOI(row) {
  const ml = s(row, 'Mã lớp').toLowerCase();
  return ['chuyển đổi', 'chuyen doi', 'chuyendoi'].includes(ml);
}

function buildData(allRows) {
  // filter Chuyển đổi
  const rowsBefore = allRows.length;
  const rows = allRows.filter(r => !isCHUYEN_DOI(r));
  const rowsExcluded = rowsBefore - rows.length;

  const EXAMS_BASE = ['TSA', 'HSA', 'V-ACT'];
  const examsSeen = [...new Set(rows.map(r => s(r, 'exam')).filter(Boolean))];
  const EXAMS = [
    ...EXAMS_BASE,
    ...examsSeen.filter(e => !EXAMS_BASE.includes(e)).sort(),
  ];
  const examSet = new Set(EXAMS);

  // exam_stats
  const exam_stats = {};
  for (const ex of EXAMS) {
    const sub = rows.filter(r => s(r, 'exam') === ex);
    const total = sub.length;
    const d130 = sub.filter(r => s(r, 'Trạng thái duyệt 1:30') === 'Duyệt').length;
    const daim = sub.filter(r => s(r, 'Trạng thái duyệt AIM') === 'Duyệt').length;
    const soNhom = new Set(sub.map(r => s(r, 'Mã lớp')).filter(Boolean)).size;
    exam_stats[ex] = {
      tong_hs: total,
      duyet_130: d130,
      duyet_aim: daim,
      so_nhom: soNhom,
      ti_le_130: total ? Math.round(d130 / total * 10000) / 100 : 0,
      ti_le_aim: total ? Math.round(daim / total * 10000) / 100 : 0,
    };
  }

  // monthly_chart
  const monthlyMap = {};
  for (const ex of EXAMS) monthlyMap[ex] = {};
  for (const r of rows) {
    const ex = s(r, 'exam');
    if (!examSet.has(ex)) continue;
    const m = paidMonth(r['paid_time']);
    if (!m || m.startsWith('1970')) continue;
    if (!monthlyMap[ex][m]) monthlyMap[ex][m] = { total: 0, duyet_130: 0, duyet_aim: 0 };
    monthlyMap[ex][m].total++;
    if (s(r, 'Trạng thái duyệt 1:30') === 'Duyệt') monthlyMap[ex][m].duyet_130++;
    if (s(r, 'Trạng thái duyệt AIM') === 'Duyệt') monthlyMap[ex][m].duyet_aim++;
  }
  const all_months = [...new Set(Object.values(monthlyMap).flatMap(m => Object.keys(m)))].sort();
  const monthly_chart = {};
  for (const ex of EXAMS) {
    monthly_chart[ex] = all_months.map(m => {
      const b = monthlyMap[ex][m] || { total: 0, duyet_130: 0, duyet_aim: 0 };
      return { month: m, ...b };
    });
  }

  // weekly_chart
  const weeklyMap = {};
  for (const ex of EXAMS) weeklyMap[ex] = {};
  for (const r of rows) {
    const ex = s(r, 'exam');
    if (!examSet.has(ex)) continue;
    const w = weekLabel(r);
    if (!w) continue;
    if (!weeklyMap[ex][w]) weeklyMap[ex][w] = { total: 0, duyet_130: 0, duyet_aim: 0 };
    weeklyMap[ex][w].total++;
    if (s(r, 'Trạng thái duyệt 1:30') === 'Duyệt') weeklyMap[ex][w].duyet_130++;
    if (s(r, 'Trạng thái duyệt AIM') === 'Duyệt') weeklyMap[ex][w].duyet_aim++;
  }
  function sortWeek(w) {
    const m = w.match(/W(\d+)\s*\((\d{4})\)/);
    return m ? parseInt(m[2]) * 100 + parseInt(m[1]) : 999999;
  }
  const all_weeks_per_exam = {};
  const weekly_chart = {};
  for (const ex of EXAMS) {
    const ws = Object.keys(weeklyMap[ex]).sort((a, b) => sortWeek(a) - sortWeek(b));
    all_weeks_per_exam[ex] = ws;
    weekly_chart[ex] = ws.map(w => ({ week: w, ...weeklyMap[ex][w] }));
  }

  // top20
  function topGroups(ex, statusKey) {
    const grp = {};
    for (const r of rows) {
      if (s(r, 'exam') !== ex) continue;
      const ml = s(r, 'Mã lớp');
      const gv = s(r, 'GV');
      const k = `${ml}|||${gv}`;
      if (!grp[k]) grp[k] = { ma_lop: ml, gv, total: 0, duyet: 0 };
      grp[k].total++;
      if (s(r, statusKey) === 'Duyệt') grp[k].duyet++;
    }
    return Object.values(grp)
      .filter(g => g.total > 0)
      .map(g => ({ ...g, ti_le: g.total ? Math.round(g.duyet / g.total * 10000) / 100 : 0 }))
      .sort((a, b) => b.ti_le - a.ti_le)
      .slice(0, 20);
  }
  const top20_130 = {}, top20_aim = {};
  for (const ex of EXAMS) {
    top20_130[ex] = topGroups(ex, 'Trạng thái duyệt 1:30');
    top20_aim[ex] = topGroups(ex, 'Trạng thái duyệt AIM');
  }

  // group_summary
  const FULL_THRESHOLD = 28;
  function groupSizeSummary(ex) {
    const grp = {};
    for (const r of rows) {
      if (s(r, 'exam') !== ex) continue;
      const k = `${s(r, 'Mã lớp')}|||${s(r, 'GV')}`;
      grp[k] = (grp[k] || 0) + 1;
    }
    const sizes = Object.values(grp);
    return {
      full: sizes.filter(n => n >= FULL_THRESHOLD).length,
      tu_23_27: sizes.filter(n => n >= 23 && n < FULL_THRESHOLD).length,
      tu_18_22: sizes.filter(n => n >= 18 && n <= 22).length,
      duoi_18: sizes.filter(n => n < 18).length,
      tong_nhom: sizes.length,
    };
  }
  const group_summary = {};
  for (const ex of EXAMS) group_summary[ex] = groupSizeSummary(ex);

  // hsa_pie
  const hsa_pie = {};
  for (const r of rows) {
    if (s(r, 'exam') !== 'HSA') continue;
    const v = r['hsa_type'];
    let label;
    if (v == null || v === '' || v === 0 || v === '0') {
      label = 'Không xác định';
    } else {
      const sv = String(v).trim().toLowerCase();
      if (sv.includes('tiếng anh') || sv.includes('tieng anh') || sv.includes('english') || sv === 'anh') label = 'Tiếng Anh';
      else if (sv.includes('khoa học') || sv.includes('khoa hoc') || sv.includes('science') || sv.includes('tự nhiên')) label = 'Khoa học';
      else label = `Khác (${sv})`;
    }
    hsa_pie[label] = (hsa_pie[label] || 0) + 1;
  }

  // groups_by_exam (cho tab 1.3)
  const gbxMap = {};
  for (const r of rows) {
    const ex = s(r, 'exam');
    const ml = s(r, 'Mã lớp');
    if (!ex || !ml) continue;
    const k = `${ex}|||${ml}`;
    if (!gbxMap[k]) gbxMap[k] = { exam: ex, ma_lop: ml, gv: '', tong_hs: 0, duyet_130: 0, duyet_aim: 0 };
    gbxMap[k].tong_hs++;
    if (s(r, 'Trạng thái duyệt 1:30') === 'Duyệt') gbxMap[k].duyet_130++;
    if (s(r, 'Trạng thái duyệt AIM') === 'Duyệt') gbxMap[k].duyet_aim++;
    if (!gbxMap[k].gv) gbxMap[k].gv = s(r, 'GV');
  }
  const groups_by_exam = {};
  for (const g of Object.values(gbxMap)) {
    g.ti_le_130 = g.tong_hs ? Math.round(g.duyet_130 / g.tong_hs * 10000) / 100 : 0;
    g.ti_le_aim = g.tong_hs ? Math.round(g.duyet_aim / g.tong_hs * 10000) / 100 : 0;
    if (!groups_by_exam[g.exam]) groups_by_exam[g.exam] = [];
    groups_by_exam[g.exam].push(g);
  }
  for (const ex of Object.keys(groups_by_exam)) {
    groups_by_exam[ex].sort((a, b) => b.ti_le_130 - a.ti_le_130 || b.duyet_130 - a.duyet_130);
  }

  // lookup (subset columns để giảm size)
  const groupCounter = {};
  for (const r of rows) {
    const k = `${s(r, 'exam')}|||${s(r, 'Mã lớp')}|||${s(r, 'GV')}`;
    if (!groupCounter[k]) groupCounter[k] = { total: 0, chua: 0 };
    groupCounter[k].total++;
    if (s(r, 'Trạng thái duyệt 1:30') !== 'Duyệt') groupCounter[k].chua++;
  }

  const lookup = rows.map(r => {
    const rawPt = r['paid_time'] || '';
    const ptStr = String(rawPt).trim();
    // ms timestamp for date range filter
    let ptMs = 0;
    try {
      const d = new Date(ptStr.replace(' ', 'T'));
      if (!isNaN(d) && d.getFullYear() > 2000) ptMs = d.getTime();
    } catch (_) {}

    const gkey = `${s(r, 'exam')}|||${s(r, 'Mã lớp')}|||${s(r, 'GV')}`;
    const gc = groupCounter[gkey] || { total: 0, chua: 0 };

    return {
      userid: s(r, 'userid'),
      username: s(r, 'username'),
      final_phone: s(r, 'final_phone'),
      final_email: s(r, 'final_email'),
      product_id: s(r, 'product_id'),
      paid_time: ptStr,
      'link group': s(r, 'link group'),
      'GV': s(r, 'GV'),
      'SĐT GV': s(r, 'SĐT GV'),
      'Mã bảo mật': s(r, 'Mã bảo mật'),
      'Nhom_AIM': s(r, 'Nhom_AIM'),
      'Link_AIM': s(r, 'Link_AIM'),
      'Trạng thái duyệt 1:30': s(r, 'Trạng thái duyệt 1:30'),
      'Thời gian duyệt': s(r, 'Thời gian duyệt'),
      'Trạng thái duyệt AIM': s(r, 'Trạng thái duyệt AIM'),
      hsa_type: s(r, 'hsa_type'),
      // ver8: Flow 7 accept-members API fields
      'Group_id': s(r, 'Group_id'),
      'Zalo_id': s(r, 'Zalo_id'),
      'Display Name': s(r, 'Display Name'),
      _exam: s(r, 'exam'),
      _ma_lop: s(r, 'Mã lớp'),
      _gv: s(r, 'GV'),
      _type: s(r, 'type'),
      _paid_time_iso: ptStr,
      _paid_time_ms: ptMs,
      _chua_vao_lop:
        s(r, 'Trạng thái duyệt 1:30') !== 'Duyệt' &&
        s(r, 'Trạng thái duyệt AIM') !== 'Duyệt',
      _so_chua_trong_nhom: gc.chua,
      _tong_trong_nhom: gc.total,
    };
  });

  // Thêm trường gửi email vào từng lookup row để UI có thể dùng
  for (const r of lookup) {
      // Normalize email sender: ưu tiên ssc.hmo2026@hocmai.vn thay vì thuypt2@hocmai.vn
      if (r.final_email === 'thuypt2@hocmai.vn' || r.final_email === '') {
        r._email_sender = 'ssc.hmo2026@hocmai.vn';
      } else {
        r._email_sender = r.final_email;
      }
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const generated_at = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const rows_no_exam = rows.filter(r => !s(r, 'exam')).length;

  return {
    ok: true,
    generated_at,
    total_rows: rows.length,
    rows_excluded_chuyen_doi: rowsExcluded,
    rows_no_exam,
    sheet_url: TOPUNI2_DATA_API_URL,
    data_source: 'topuni2-data-api',
    exams: EXAMS,
    exam_stats,
    all_months,
    monthly_chart,
    weekly_chart,
    all_weeks_per_exam,
    top20_130,
    top20_aim,
    group_summary,
    hsa_pie,
    groups_by_exam,
    lookup,
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  // Serve from memory cache nếu còn mới
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) {
    res.status(200).json(_cache);
    return;
  }

  // Fetch từ TopUni2 data API
  try {
    const rows = await fetchTopuni2Rows();
    const result = buildData(rows);
    _cache = result;
    _cacheTime = now;

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
