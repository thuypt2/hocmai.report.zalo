// Test resolveTemplateContent logic chính xác như file api/send-class-group-email.js
const fs = require('fs');
const path = require('path');
const { fetchGET } = require('../api/_lib/fetch-gapps');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxQKeHZ37tSLjtOoTzJjXZeRYGfSXvIeNUFMxcqFZpRkEOyu6ciwpD6oTwhm2eRbDuqDA/exec';
const TEMPLATES_DIR = path.join(process.cwd(), 'api', 'templates');

function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';
  const trimmed = htmlBody.trim();
  if (!(/[\\/]/.test(trimmed) || trimmed.endsWith('.txt'))) return trimmed;
  const filename = trimmed.replace(/[\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, filename);
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
    console.error('NOT FOUND:', filePath);
  } catch (e) {
    console.error('ERR:', e.message);
  }
  return trimmed;
}

(async () => {
  const url = APPS_SCRIPT_URL + '?action=getAllSpreadsheetData&sheet=Email_Templates';
  const json = await fetchGET(url);
  for (const r of json.data) {
    const body = resolveTemplateContent(r.html_body);
    console.log(r.template_key, '→ html_body:', body.length, 'bytes | starts:', JSON.stringify(body.slice(0, 60)));
  }
})();