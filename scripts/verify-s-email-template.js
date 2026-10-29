// Verify: dữ liệu bảng 2.2/3.2 → payload gửi email → template nhóm S/A (SSC:HDAIM-S)
// Không gửi email thật. Dùng CHÍNH hàm thật trong apps-script-main.js và api/send-sgroup-email.js
// (trích xuất trực tiếp từ source để test không bị lệch theo thời gian).
// Chạy: node scripts/verify-s-email-template.js [_sg.json]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataFile = path.join(root, process.argv[2] || '_sg.json');
const sg = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const tpl = fs.readFileSync(path.join(root, 'api/templates/HOCMAI S - Nhac nho.txt'), 'utf8');

// ── Trích hàm thật từ source ────────────────────────────────────────────────
function extractFn(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) throw new Error('Không tìm thấy function ' + name);
  let depth = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('Không tách được function ' + name);
}

const asSrc = fs.readFileSync(path.join(root, 'apps-script-main.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(root, 'api', 'send-sgroup-email.js'), 'utf8');

const sandbox = {};
new Function(
  'sandbox',
  extractFn(asSrc, 'renderTemplate') + '\n' +
  extractFn(asSrc, 'sGroupLoTrinh') + '\n' +
  extractFn(apiSrc, 'resolveLoTrinh') + '\n' +
  extractFn(apiSrc, 'subjectForLoTrinh') + '\n' +
  'sandbox.renderTemplate = renderTemplate;' +
  'sandbox.sGroupLoTrinh = sGroupLoTrinh;' +
  'sandbox.resolveLoTrinh = resolveLoTrinh;' +
  'sandbox.subjectForLoTrinh = subjectForLoTrinh;'
)(sandbox);

const { renderTemplate, sGroupLoTrinh, resolveLoTrinh, subjectForLoTrinh } = sandbox;

// Tiêu đề mẫu lấy từ sheet Email_Templates (key SSC:HDAIM-S)
const SUBJECT = '[HOCMAI] Nhắc nhở tham gia Nhóm AIM S - Giải pháp TopUni';

// Payload client — khớp emailSendSelectedES() trong BaoCaoZalo_v1.html
function buildPayload(r) {
  return {
    email: (r.email || '').trim(),
    username: r.username || '',
    linknhom: r.link_nhom || '',
    mabaomats: r.mabaomat || '',
    exam: r.exam || '',
    type: r.type || '',
    class: r.class || '',
    ten_group_aim: r.ten_group_aim || '',
    link_aim: r.link_aim || 'https://hocmai.link/VACTaim900plus',
  };
}

// Data mapping — khớp handleSendSelectedEmails() trong apps-script-main.js
function buildData(p) {
  const student = {
    username: p.username, linknhom: p.linknhom, mabaomats: p.mabaomats,
    link_aim: p.link_aim, exam: p.exam, type: p.type, class: p.class,
    ten_group_aim: p.ten_group_aim,
  };
  return {
    'exam': student.exam || '',
    'type': student.type || '',
    'class': student['class'] || '',
    'ten_group_aim': student.ten_group_aim || '',
    'Link_AIM': student.link_aim || '',
    'linknhom': student.linknhom || '',
    'mabaomatS': student.mabaomats || '',
    'username': student.username || '',
    'lo_trinh': sGroupLoTrinh(student),
  };
}

const valid = sg.data.filter(r => r.email && r.link_nhom && r.ten_group_aim);
const pick = (type, n) => valid.filter(r => String(r.type || '').trim().toUpperCase() === type).slice(0, n);
const samples = [...pick('A', 3), ...pick('S', 5)];
if (!samples.length) { console.log('KHÔNG có dòng mẫu để kiểm tra'); process.exit(1); }

let bad = 0;
samples.forEach((r, i) => {
  const p = buildPayload(r);
  const d = buildData(p);
  const loTrinh = resolveLoTrinh(p);
  const out = renderTemplate(tpl, d);
  const subject = subjectForLoTrinh(SUBJECT, loTrinh);

  const left = out.match(/{{[^}]*}}/g);
  const okGroup = out.includes(d.ten_group_aim);
  const okExam = out.includes('>' + d.exam + '<');
  const okLink = out.includes('href="' + d.linknhom + '"');
  const okAim = out.includes('href="' + d.Link_AIM + '"');
  const maCount = d.mabaomatS ? out.split(d.mabaomatS).length - 1 : 0;
  const loTrinhHtml = (out.match(/Lộ trình ([^<\s]+)/) || [, ''])[1];
  const okLoTrinh = loTrinhHtml === loTrinh;
  const okSubject = subject.includes('AIM ' + loTrinh + ' ');

  console.log('--- HS ' + (i + 1) + ': ' + p.email + '  [type=' + (d.type || '(trống)') + ' / gói ' + loTrinh + ']');
  console.log('    exam         : ' + d.exam);
  console.log('    ten_group_aim: ' + d.ten_group_aim);
  console.log('    linknhom     : ' + d.linknhom);
  console.log('    mabaomatS    : ' + d.mabaomatS + ' (xuất hiện ' + maCount + ' lần, cần 2)');
  console.log('    Link_AIM     : ' + d.Link_AIM);
  console.log('    Lộ trình     : ' + (loTrinhHtml || '(không thấy)') + (okLoTrinh ? ' OK' : ' !! SAI (cần ' + loTrinh + ')'));
  console.log('    subject      : ' + subject + (okSubject ? '  OK' : '  !! SAI'));
  console.log('    render OK    : group=' + okGroup + ' exam=' + okExam + ' linknhom=' + okLink + ' Link_AIM=' + okAim);
  if (left) console.log('    !! còn placeholder: ' + [...new Set(left)].join(', '));

  if (left || !okGroup || !okExam || !okLink || !okAim || maCount !== 2 || !okLoTrinh || !okSubject) bad++;
});

const nA = samples.filter(r => String(r.type || '').toUpperCase() === 'A').length;
const nS = samples.length - nA;
console.log(bad === 0
  ? '\nALL OK — ' + samples.length + ' mẫu (' + nS + ' gói S, ' + nA + ' gói A): không còn placeholder, Lộ trình + tiêu đề + dữ liệu cột khớp đúng'
  : '\nCÓ LỖI ở ' + bad + '/' + samples.length + ' mẫu');
process.exit(bad === 0 ? 0 : 1);
