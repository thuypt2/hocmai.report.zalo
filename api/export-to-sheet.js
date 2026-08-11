// Vercel API route — proxy sang Apps Script: xuất data selected ra Google Sheet mới (tab 3)
// Frontend gửi { header: [...], data: [[...]] } → route gzip+base64 → Apps Script tạo
// spreadsheet mới (thuộc ssc.hmo2026@hocmai.vn) và ghi dữ liệu, trả về URL.

import { gzipSync } from 'zlib';

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbyl0pjYwfE0IfiAyV952BTUSeV75yTmXjGgImTrskVVLNtOp608ZNRyc97ZZR6kF5_gOg/exec';
const APPS_SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET || '@Hocmai123';
const APPS_SCRIPT_TIMEOUT = 120000; // 2 phút
const MAX_ROWS = 2000;

// Config Vercel serverless
export const config = {
  api: {
    bodyParser: false,
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

async function callAppsScript(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);

  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: 'Apps Script trả về không phải JSON', raw: text.slice(0, 500) };
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { ok: false, error: 'Apps Script timeout (>2 phút)' };
    }
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  // CORS
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

    const { header, data } = body;

    if (!Array.isArray(header) || !header.length) {
      return res.status(400).json({ ok: false, error: 'Thiếu header' });
    }
    if (!Array.isArray(data) || !data.length) {
      return res.status(400).json({ ok: false, error: 'Không có dữ liệu để xuất' });
    }
    if (data.length > MAX_ROWS) {
      return res.status(400).json({ ok: false, error: 'Quá nhiều dòng (tối đa ' + MAX_ROWS + ')' });
    }

    // Gzip + base64 payload { header, data } để tránh giới hạn kích thước
    const gzipped = gzipSync(Buffer.from(JSON.stringify({ header, data }), 'utf-8'));
    const b64 = gzipped.toString('base64');

    const result = await callAppsScript({
      action: 'exportDataToSheet',
      secret: APPS_SCRIPT_SECRET,
      gz: b64,
      n: data.length,
    });

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
