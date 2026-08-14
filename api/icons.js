// Vercel API route — serve social icon PNGs for email footer
// URL: https://hocmai-report-zalo.vercel.app/api/icons/facebook.png
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, 'icons');

const CONTENT_TYPES = { '.png': 'image/png' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // req.url like /api/icons/facebook.png
  const name = (req.url.match(/\/api\/icons\/([^/?]+)/) || [])[1];
  if (!name) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  const filePath = path.join(ICONS_DIR, name);
  // Guard: only files directly in icons dir
  if (path.dirname(filePath) !== ICONS_DIR || !fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  const ext = path.extname(filePath);
  if (!CONTENT_TYPES[ext]) {
    return res.status(415).json({ ok: false, error: 'Unsupported type' });
  }

  const data = fs.readFileSync(filePath);
  res.setHeader('Content-Type', CONTENT_TYPES[ext]);
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache for images
  return res.status(200).send(data);
};