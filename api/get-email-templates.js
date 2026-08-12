// Vercel API route — proxy sang Apps Script để lấy mẫu email từ sheet Email_Templates
// Dùng chung Apps Script URL với send-class-group-email
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

const EMAIL_TEMPLATES_API_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxQKeHZ37tSLjtOoTzJjXZeRYGfSXvIeNUFMxcqFZpRkEOyu6ciwpD6oTwhm2eRbDuqDA/exec';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút cache
let _cache = null;
let _cacheTime = 0;

/**
 * Nếu htmlBody là đường dẫn file, đọc nội dung thực từ api/templates/.
 */
function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';
  const trimmed = htmlBody.trim();
  // Detect file path: contains backslash/forward slash, or ends with .txt
  if (!(/[\\\\/]/.test(trimmed) || trimmed.endsWith('.txt'))) return trimmed;
  const filename = path.basename(trimmed);
  const filePath = path.join(TEMPLATES_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    console.warn('Template file not found:', filePath);
  } catch (e) {
    console.error('Error reading template:', filePath, e.message);
  }
  return trimmed; // fallback
}

function getField(item, names, fallbackIndices) {
  const headerKeys = Object.keys(item);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[_\s]+/g, '');
    for (const key of headerKeys) {
      const normalizedKey = key.toLowerCase().replace(/[_\s]+/g, '');
      if (normalizedKey === normalized && item[key]) {
        return String(item[key]).trim();
      }
    }
  }
  for (const idx of fallbackIndices || []) {
    const colLabel = String.fromCharCode(65 + idx);
    if (item[colLabel]) return String(item[colLabel]).trim();
  }
  for (const idx of fallbackIndices || []) {
    const val = item[idx];
    if (val != null && val !== '') return String(val).trim();
  }
  return '';
}

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
  // Cho phép bypass cache với ?reset=1
  const forceRefresh = (req.query && req.query.reset === '1');
  if (!forceRefresh && _cache && (now - _cacheTime) < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_cache);
  }
  res.setHeader('X-Cache', 'MISS');

  try {
    const url = EMAIL_TEMPLATES_API_URL + '?action=getAllSpreadsheetData&sheet=Email_Templates';
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!response.ok) {
      throw new Error('Apps Script HTTP ' + response.status);
    }

    const json = await response.json();

    if (!json.ok) {
      return res.status(200).json({
        ok: true,
        generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        total: 0,
        data: [],
        error: json.error || 'Apps Script chưa hỗ trợ sheet=Email_Templates.',
      });
    }

    // Format data từ sheet Email_Templates
    const formattedData = (json.data || []).map((item) => {
      const subject = getField(item, ['Subject', 'subject', 'Chủ đề', 'Chu de', 'Tên mẫu'], [1]);
      const htmlBody = getField(item, ['html_body', 'Html_body', 'HTML_body', 'htmlBody', 'HTMLBody', 'Nội dung HTML', 'Noi dung HTML'], [2]);
      const templateName = getField(item, ['template_key', 'templatekey', 'TemplateName', 'template_name', 'Template Name', 'Tên mẫu', 'Mã mẫu', 'key'], [0]);

      return {
        key: templateName || subject || 'template_' + Math.random().toString(36).substr(2, 9),
        name: subject || templateName || 'Mẫu không tên',
        subject: subject,
        html_body: resolveTemplateContent(htmlBody) || '',
      };
    });

    // Lọc bỏ dòng lỗi
    const isErrorValue = (v) => {
      const s = String(v || '').trim().toUpperCase();
      if (!s) return false;
      return s === 'N/A' || s.startsWith('#N/A') || s.startsWith('#REF')
          || s.startsWith('#VALUE') || s.startsWith('#DIV')
          || s.startsWith('#ERROR') || s === '#NULL!' || s === '#NUM!';
    };
    const cleanData = formattedData.filter(row => {
      for (const v of Object.values(row)) {
        if (isErrorValue(v)) return false;
      }
      if (!row.subject || !row.subject.trim()) return false;
      return true;
    });

    _cache = {
      ok: true,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      total: cleanData.length,
      data: cleanData,
    };
    _cacheTime = now;

    return res.status(200).json(_cache);

  } catch (err) {
    console.error('get-email-templates error:', err.message);
    return res.status(200).json({
      ok: true,
      generated_at: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      total: 0,
      data: [],
      error: 'Không thể tải mẫu email: ' + err.message,
    });
  }
};