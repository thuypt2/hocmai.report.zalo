// Shared utility: HTTP GET with cross-domain redirect support + retry
// Vercel's fetch() cannot follow 302 redirect from script.google.com → script.googleusercontent.com
// Node's native https module handles this correctly.
// Google rate-limits datacenter IPs intermittently (returns HTML instead of JSON) — retry mitigates this.
const https = require('https');
const http = require('http');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [0, 1500, 3000]; // wait before attempt 2, 3

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Vercel/1.0', 'Accept': 'application/json' },
      timeout: 60000,
    }, (res) => {
      // Follow redirect (Google Apps Script: 302 script.google.com → script.googleusercontent.com)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchOnce(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) {
          // Nếu Google trả HTML (rate-limit page / redirect page), báo lỗi rõ
          const isHtml = /^\s*<!DOCTYPE/i.test(data) || /^\s*<html/i.test(data);
          reject(new Error(isHtml ? 'Google trả HTML thay vì JSON (rate-limit)' : 'Không parse JSON: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout kết nối Apps Script')); });
  });
}

function fetchGET(url, attempts) {
  const n = attempts || 1;
  return fetchOnce(url).catch(err => {
    if (n < MAX_ATTEMPTS) {
      const delay = RETRY_DELAY_MS[n] || 3000;
      return new Promise(resolve => setTimeout(resolve, delay))
        .then(() => fetchGET(url, n + 1));
    }
    throw err;
  });
}

module.exports = { fetchGET };