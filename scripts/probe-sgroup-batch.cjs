// Probe nhánh BATCH của api/send-sgroup-email.js — stub Apps Script, không gửi mail thật.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Readable } = require('stream');

const REPO = process.argv[2] || process.cwd();
const file = path.join(REPO, 'api', 'send-sgroup-email.js');
let src = fs.readFileSync(file, 'utf8');
src = src.replace('export default async function handler', 'async function handler');
src = src.replace(/export const config[\s\S]*?\n\};/, 'const config = {};');
src += '\nmodule.exports = { handler };\n';

const rows = JSON.parse(fs.readFileSync(path.join(REPO, '_rows.json'), 'utf8'));
const rowsArr = Array.isArray(rows) ? rows : rows.data;
const calls = [];

const m = new Module(file, null);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
const origRequire = m.require.bind(m);
m.require = function (id) {
  if (id.indexOf('fetch-gapps') >= 0) {
    return {
      fetchGET: async () => ({ ok: true, data: rowsArr }),
      fetchPOST: async (url, payload) => {
        calls.push(payload);
        return { ok: true, sent: payload.selectedEmails.length, errors: 0, sent_ids: payload.selectedEmails };
      },
    };
  }
  return origRequire(id);
};
m._compile(src, file);

const students = [
  { email: 'a1@x.vn', username: 'hs_01', exam: 'HSA', type: 'S', ten_group_aim: 'HOCMAI S HSA 100+', mabaomats: 'S111', link_aim: 'L1', linknhom: 'L1' },
  { email: 'a2@x.vn', username: 'hs_02', exam: 'HSA', type: 'S', ten_group_aim: 'HOCMAI S HSA 100+', mabaomats: 'S112', link_aim: 'L1', linknhom: 'L1' },
  { email: 'a3@x.vn', username: 'hs_03', exam: 'HSA', type: 'A', ten_group_aim: 'HOCMAI A HSA 100+', mabaomats: 'A111', link_aim: 'L2', linknhom: 'L2' },
  { email: 'a1@x.vn', username: 'hs_01', exam: 'HSA', type: 'S' },   // trùng email → phải bị dedup
];

(async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ students, templateKey: 'SSC:HDNhansach' }), 'utf8')]);
  req.method = 'POST';
  let out = null;
  const res = { setHeader() {}, status() { return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await m.exports.handler(req, res);

  console.log('response:', JSON.stringify(out));
  console.log('so lan goi Apps Script:', calls.length);
  for (const c of calls) {
    const html = c.templateBody || '';
    console.log('--- nhom:', c.templateSubject.includes('AIM A') ? 'A' : 'S',
      '| emails:', c.selectedEmails.join(','),
      '| limit:', c.limit);
    console.log('    product_name:', /Giải pháp <strong>([^<]*)<\/strong>/.exec(html)?.[1] || '(MISSING)');
    console.log('    {{username}} giu nguyen (AS render):', (html.match(/\{\{\s*username\s*\}\}/g) || []).length);
    console.log('    con $json:', (html.match(/\{\{\s*\$json[^}]*\}\}/g) || []).length);
  }
})();
