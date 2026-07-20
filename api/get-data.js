// Vercel API route — gọi TopUni2 data API + tính KPI
// Trả về: { ok, generated_at, total_rows, exam_stats, monthly_chart,
//            groups_by_exam, exams, lookup }

const TOPUNI2_DATA_API_URL =
  process.env.TOPUNI2_DATA_API_URL || 'https://onboard-topuni.hocmai.io.vn/api/topuni2-data';
const TOPUNI2_DATA_API_SECRET = process.env.TOPUNI2_DATA_API_SECRET || '';

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheTime = 0;

async function fetchTopuni2Rows() {
  const headers = { 'User-Agent': 'HocmaiReportZalo/1.0' };
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

function s(row, key) {
  const v = row[key];
  if (v == null) return '';
  return String(v).trim();
}

function paidMonth(v) {
  if (!v) return null;
  const str = String(v).trim();
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

function isCHUYEN_DOI(row) {
  const ml = s(row, 'Mã lớp').toLowerCase();
  return ['chuyển đổi', 'chuyen doi', 'chuyendoi'].includes(ml);
}

function buildData(allRows) {
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

  // groups_by_exam
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

  // lookup
  const lookup = rows.map(r => {
    const rawPt = r['paid_time'] || '';
    const ptStr = String(rawPt).trim();
    let ptMs = 0;
    try {
      const d = new Date(ptStr.replace(' ', 'T'));
      if (!isNaN(d) && d.getFullYear() > 2000) ptMs = d.getTime();
    } catch (_) {}

    return {
      userid: s(r, 'userid'),
      username: s(r, 'username'),
      final_phone: s(r, 'final_phone'),
      final_email: s(r, 'final_email'),
      product_id: s(r, 'product_id'),
      paid_time: ptStr,
      'link group': s(r, 'link group'),
      GV: s(r, 'GV'),
      'SĐT GV': s(r, 'SĐT GV'),
      'Mã bảo mật': s(r, 'Mã bảo mật'),
      Nhom_AIM: s(r, 'Nhom_AIM'),
      Link_AIM: s(r, 'Link_AIM'),
      'Trạng thái duyệt 1:30': s(r, 'Trạng thái duyệt 1:30'),
      'Thời gian duyệt': s(r, 'Thời gian duyệt'),
      'Trạng thái duyệt AIM': s(r, 'Trạng thái duyệt AIM'),
      hsa_type: s(r, 'hsa_type'),
      Group_id: s(r, 'Group_id'),
      Zalo_id: s(r, 'Zalo_id'),
      'Display Name': s(r, 'Display Name'),
      _exam: s(r, 'exam'),
      _ma_lop: s(r, 'Mã lớp'),
      _gv: s(r, 'GV'),
      _type: s(r, 'type'),
      _paid_time_iso: ptStr,
      _paid_time_ms: ptMs,
    };
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const generated_at = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    ok: true,
    generated_at,
    total_rows: rows.length,
    rows_excluded_chuyen_doi: rowsExcluded,
    data_source: 'topuni2-data-api',
    exams: EXAMS,
    exam_stats,
    all_months,
    monthly_chart,
    groups_by_exam,
    lookup,
  };
}

module.exports = async function handler(req, res) {
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

  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) {
    res.status(200).json(_cache);
    return;
  }

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
