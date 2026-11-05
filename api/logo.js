// Vercel API route — serve logo HOCMAI TopUni cho header email
// URL: https://hocmai-report-zalo.vercel.app/api/logo
//
// Vì sao không dùng link WordPress (huongnghiep.hocmai.vn)? Domain đó chạy sau Cloudflare
// và hay trả challenge/403 cho IP của Google Image Proxy (Gmail tải ảnh qua proxy của họ),
// nên trong email logo bị mất. Serve từ chính domain Vercel = luôn tải được.
const fs = require('fs');
const path = require('path');

const LOGO_FILE = path.join(__dirname, 'icons', 'logo-topuni.png');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const data = fs.readFileSync(LOGO_FILE);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngày
    return res.status(200).send(data);
  } catch (e) {
    return res.status(404).json({ ok: false, error: 'Logo not found' });
  }
};
