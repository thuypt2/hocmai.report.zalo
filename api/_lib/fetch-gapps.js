// Shared utility: HTTP GET with cross-domain redirect support
// Vercel's fetch() cannot follow 302 redirect from script.google.com → script.googleusercontent.com
// Node's native https module handles this correctly.
const https = require('https');
const http = require('http');

function fetchGET(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Vercel/1.0', 'Accept': 'application/json' },
      timeout: 60000,
    }, (res) => {
      // Follow redirect (Google Apps Script: 302 script.google.com → script.googleusercontent.com)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchGET(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Không parse JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout kết nối Apps Script')); });
  });
}

module.exports = { fetchGET };