// Vercel API route — proxy sang Apps Script gửi email nhóm S (tab 2.2 sub-s-group)
// Truyền URL ảnh hướng dẫn qua query param, Apps Script chèn thẻ <img> vào HTML

const SGROUP_APPS_SCRIPT_URL = process.env.SGROUP_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzKaXJfwHknKqZJ0aJRFomT83kCaSTTUuLkKg2Hj6WgrDfgDHfjKuNTQ5WQ48lL9Mqp/exec';
const IMAGE_URL = 'https://hocmai-report-zalo.vercel.app/huong-dan-vao-aim.png';
const APPS_SCRIPT_TIMEOUT = 240000;

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

    const { email, username, linknhom, mabaomats, link_aim, templateKey } = body;
    if (!email) return res.status(400).json({ ok: false, error: 'Thiếu email' });

    const params = new URLSearchParams({
      action: 'sendIndividualEmail',
      secret: '@Hocmai123',
      templateKey: templateKey || 'SSC:HDAIM-S',
      email: email,
      username: username || '',
      linknhom: linknhom || '',
      link_aim: link_aim || '',
      mabaomats: mabaomats || '',
      imageUrl: IMAGE_URL,
    });
    const url = SGROUP_APPS_SCRIPT_URL + '?' + params.toString();

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(tid);

    const text = await resp.text();
    let result;
    try { result = JSON.parse(text); }
    catch { result = { ok: false, error: 'Apps Script trả về không phải JSON', raw: text.slice(0, 500) }; }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}