// Probe: drive api/send-sgroup-email.js with a real request body, stub Apps Script POST.
// Không gửi email thật — chỉ đọc payload mà Apps Script SẼ nhận.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const REPO = process.argv[2] || process.cwd();
const TPL_JSON = process.argv[3]; // file JSON của getAllSpreadsheetData&sheet=Email_Templates

const file = path.join(REPO, 'api', 'send-sgroup-email.js');
let src = fs.readFileSync(file, 'utf8');
src = src.replace('export default async function handler', 'async function handler');
src = src.replace(/export const config[\s\S]*?\n\};/, 'const config = {};');
src += '\nmodule.exports = { handler };\n';

const parsed = JSON.parse(fs.readFileSync(TPL_JSON, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : (parsed.data || []);
let captured = null;

const m = new Module(file, null);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
const origRequire = m.require.bind(m);
m.require = function (id) {
  if (id.indexOf('fetch-gapps') >= 0) {
    return {
      fetchGET: async () => ({ ok: true, data: rows }),
      fetchPOST: async (url, payload) => { captured = payload; return { ok: true, sent: 1 }; },
    };
  }
  return origRequire(id);
};
m._compile(src, file);

const { handler } = m.exports;

async function run(label, body) {
  captured = null;
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  let out = null;
  const res = {
    setHeader() {},
    status() { return this; },
    json(o) { out = o; return this; },
    end() { return this; },
  };
  await handler(req, res);
  const html = (captured && captured.templateBody) || '';
  const left = (html.match(/\{\{[^}]*\}\}/g) || []);
  console.log('=== ' + label);
  console.log('  subject:', (captured && captured.templateSubject) || '(none)');
  console.log('  html_len:', html.length, '| leftover_placeholders:', left.length ? left.join(', ') : '0');
  console.log('  ten_giai_phap_in_html:', /HOCMAI TopUni 2027 - L[^<]*/.exec(html)?.[0] || '(MISSING)');
  console.log('  username_in_html:', /Chào <strong>([^<]*)<\/strong>/.exec(html)?.[1] || '(MISSING)');
  console.log('  aim_guide_image:', html.indexOf('huong-dan-vao-aim.png') >= 0 ? 'CO (sai voi mau nay)' : 'khong (dung)');
  console.log('  response:', JSON.stringify(out));
}

(async () => {
  const base = { linknhom: 'https://hocmai.link/AHSA-aim100', mabaomats: 'A550050', exam: 'HSA',
                 link_aim: 'https://hocmai.link/AHSA-aim100', username: 'hocmai.test01',
                 templateKey: 'SSC:HDNhansach', email: 'thuypt2@hocmai.vn' };
  await run('gói A (type=A)', { ...base, type: 'A', ten_group_aim: 'HOCMAI A HSA 100+' });
  await run('gói S (type=S)', { ...base, type: 'S', ten_group_aim: 'HOCMAI S HSA 100+', mabaomats: 'S550050' });
  await run('TC (type=TC)', { ...base, type: 'TC', ten_group_aim: 'HOCMAI TN THPT AIM 25+' });
  await run('mẫu AIM cũ (SSC:HDAIM-S)', { ...base, templateKey: 'SSC:HDAIM-S', type: 'S', ten_group_aim: 'HOCMAI S HSA 100+' });
})();
