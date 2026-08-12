// Vercel API route — serve template file content by filename
// Used by Apps Script to resolve file paths in html_body column
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

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

  const { name } = req.query || {};

  if (!name) {
    // List available templates
    try {
      const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.txt'));
      return res.status(200).json({ ok: true, templates: files });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Sanitize filename: chỉ lấy basename, chống path traversal (xử lý cả \ Windows lẫn / Linux)
  const safeName = name.replace(/[\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, safeName);

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'Template not found: ' + safeName });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(content);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};