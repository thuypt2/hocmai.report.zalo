// Shared utility: HTTP GET/POST with cross-domain redirect support + retry
// Vercel's fetch() cannot follow 302 redirect from script.google.com → script.googleusercontent.com
// Node's native https module handles this correctly.
// Google rate-limits datacenter IPs intermittently (returns HTML instead of JSON) — retry mitigates this.
const https = require('https');
const http = require('http');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [0, 1500, 3000];

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Vercel/1.0', 'Accept': 'application/json' },
      timeout: 60000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchOnce(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) {
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

// POST JSON tới Apps Script, dùng https module (tránh Google security block khi dùng fetch())
function fetchPostOnce(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Vercel/1.0',
        'Accept': 'application/json',
      },
      timeout: 120000,
    };
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(options, (res) => {
      // Follow 302 redirect (script.google.com → script.googleusercontent.com)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchPostOnce(res.headers.location, body));
        return;
      }
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(text)); }
        catch(e) {
          const isHtml = /^\s*<!DOCTYPE/i.test(text) || /^\s*<html/i.test(text);
          reject(new Error(isHtml ? 'Google trả HTML thay vì JSON (rate-limit)' : 'Không parse JSON: ' + text.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout POST Apps Script')); });
    req.write(data);
    req.end();
  });
}

function fetchPOST(url, body, attempts) {
  const n = attempts || 1;
  return fetchPostOnce(url, body).catch(err => {
    if (n < MAX_ATTEMPTS) {
      const delay = RETRY_DELAY_MS[n] || 3000;
      return new Promise(resolve => setTimeout(resolve, delay))
        .then(() => fetchPOST(url, body, n + 1));
    }
    throw err;
  });
}

module.exports = { fetchGET, fetchPOST };