// Probe api/send-email.js (tab 3.1 — batch) : KHÔNG gửi mail thật, chỉ đọc payload
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const REPO = process.argv[2] || process.cwd();
const file = path.join(REPO, 'api', 'send-email.js');
let src = fs.readFileSync(file, 'utf8');
src = src.replace('export default async function handler', 'async function handler');
src = src.replace(/export const config[\s\S]*?\n\};/, 'const config = {};');
src += '\nmodule.exports = { handler };\n';

const calls = [];
const m = new Module(file, null);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
const origRequire = m.require.bind(m);
m.require = function (id) {
  if (id === 'fs' || id === 'path') return origRequire(id);
  return origRequire(id);
};
// stub global fetch → bắt payload gửi Apps Script
global.fetch = async (url, opts) => {
  calls.push(JSON.parse(opts.body));
  return { text: async () => JSON.stringify({ ok: true, sent: JSON.parse(opts.body).selectedEmails.length, errors: 0, sent_ids: JSON.parse(opts.body).selectedEmails }) };
};
m._compile(src, file);

const tpl = fs.readFileSync(path.join(REPO, 'api', 'templates', 'HOCMAI - HD nhan sach Luyen de TopUni 2027.txt'), 'utf8');

const students = [
  { email: 'a1@x.vn', username: 'hs_hsa_01', exam: 'HSA', _ma_lop: 'Hocmai HSAe-10MB' },
  { email: 'a2@x.vn', username: 'hs_hsa_02', exam: 'HSA', _ma_lop: 'Hocmai HSAe-10MB' },
  { email: 'b1@x.vn', username: 'hs_tsa_01', exam: 'TSA', _ma_lop: 'Hocmai TSAe-10MB' },
];

(async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({
    action: 'send_selected',
    templateKey: 'SSC:HDNhansach',
    templateSubject: '[HOCMAI] Hướng dẫn nhận sách giai đoạn Luyện đề - TopUni 2027',
    templateBody: tpl,
    students,
  }), 'utf8')]);
  req.method = 'POST';
  let out = null;
  const res = { setHeader() {}, status() { return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await m.exports.handler(req, res);

  console.log('response:', JSON.stringify(out));
  console.log('so lan goi Apps Script:', calls.length);
  for (const c of calls) {
    const html = c.templateBody || '';
    console.log('--- batch:', c.selectedEmails.join(','));
    console.log('    product_name trong html:', /Giải pháp <strong>([^<]*)<\/strong>/.exec(html)?.[1] || '(MISSING)');
    console.log('    con {{ $json... }}:',
      (html.match(/\{\{\s*\$json[^}]*\}\}/g) || []).join(',') || '0',
      '| con {{username}}:', (html.match(/\{\{\s*username\s*\}\}/g) || []).length);
  }
})();
