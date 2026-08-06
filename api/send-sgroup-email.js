// Vercel API route — proxy sang Apps Script gửi email nhóm S (tab 2.2 sub-s-group)
// Fetch ảnh hướng dẫn → base64 → nhúng thẳng vào HTML body
// Apps Script không cần UrlFetchApp — chỉ nhận HTML đã có sẵn ảnh inline

const SGROUP_APPS_SCRIPT_URL = process.env.SGROUP_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycby98YdJmFXMa6KuWVovVrGm6QzGe72XOLMs59DBrYndz_mZtDqcslnBTopQP9Hcki0z/exec';
const IMAGE_PUBLIC_URL = 'https://hocmai-report-zalo.vercel.app/huong-dan-vao-aim.png';
const APPS_SCRIPT_TIMEOUT = 240000;

export const config = {
  api: {
    bodyParser: { sizeLimit: '5mb' },
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

let cachedImageBase64 = null;

async function getImageBase64() {
  if (cachedImageBase64) return cachedImageBase64;
  try {
    const resp = await fetch(IMAGE_PUBLIC_URL);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    cachedImageBase64 = 'data:image/png;base64,' + buf.toString('base64');
    return cachedImageBase64;
  } catch (e) {
    console.warn('Không fetch được ảnh hướng dẫn:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
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

    const { email, username, linknhom, mabaomats, link_aim, templateKey } = body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Thiếu email' });
    }

    // Fetch ảnh → base64 (Vercel tự fetch ảnh của chính nó, không cần Apps Script)
    const imgBase64 = await getImageBase64();
    const imageBlock = imgBase64
      ? '<br><br><div style="text-align:center;margin-top:16px">' +
          '<p style="font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px">' +
            '<b>Hướng dẫn vào nhóm AIM:</b>' +
          '</p>' +
          '<img src="' + imgBase64 + '" alt="Hướng dẫn vào AIM"' +
          ' style="max-width:600px;width:100%;border-radius:8px;border:1px solid #e5e7eb">' +
        '</div>'
      : '';

    const params = new URLSearchParams({
      action: 'sendIndividualEmail',
      secret: '@Hocmai123',
      templateKey: templateKey || 'SSC:HDAIM-S',
      email: email,
      username: username || '',
      linknhom: linknhom || '',
      link_aim: link_aim || '',
      mabaomats: mabaomats || '',
      imageBlock: imageBlock,
    });
    const url = SGROUP_APPS_SCRIPT_URL + '?' + params.toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);

    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await resp.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { ok: false, error: 'Apps Script trả về không phải JSON', raw: text.slice(0, 500) };
    }

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}