// Verify: dữ liệu bảng 2.2/3.2 (sau khi đổi bộ cột) → payload gửi email → template SSC:HDAIM-S
// Không gửi email thật. Render offline y hệt apps-script-main.js + api/send-sgroup-email.js.
// Chạy: node scripts/verify-s-email-template.js [_sg.json]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataFile = path.join(root, process.argv[2] || '_sg.json');
const sg = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const tmpl = fs.readFileSync(path.join(root, 'api/templates/HOCMAI S - Nhac nho.txt'), 'utf8');

// renderTemplate() — copy nguyên logic apps-script-main.js
function renderTemplate(text, data) {
  let result = text || '';
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = data[key] || '';
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('{{\\s*' + escapedKey + '\\s*}}', 'gi');
    result = result.replace(pattern, value);
  }
  return result;
}

// Payload client — copy từ emailSendSelectedES() trong BaoCaoZalo_v1.html
function buildPayload(r) {
  return {
    email: (r.email || '').trim(),
    username: r.username || '',
    linknhom: r.link_nhom || '',
    mabaomats: r.mabaomat || '',
    exam: r.exam || '',
    ten_group_aim: r.ten_group_aim || '',
    link_aim: r.link_aim || 'https://hocmai.link/VACTaim900plus',
  };
}

// Data mapping — copy từ sendClassGroupEmails() trong apps-script-main.js
function buildData(p) {
  const student = {
    email: p.email, username: p.username, linknhom: p.linknhom,
    mabaomats: p.mabaomats, link_aim: p.link_aim,
    exam: p.exam, ten_group_aim: p.ten_group_aim,
  };
  return {
    'exam': student.exam || '',
    'ten_group_aim': student.ten_group_aim || '',
    'Link_AIM': student.link_aim || '',
    'linknhom': student.linknhom || '',
    'mabaomatS': student.mabaomats || '',
    'username': student.username || '',
  };
}

const samples = sg.data.filter(r => r.email && r.link_nhom && r.ten_group_aim).slice(0, 5);
if (!samples.length) { console.log('KHÔNG có dòng mẫu để kiểm tra'); process.exit(1); }

let bad = 0;
samples.forEach((r, i) => {
  const p = buildPayload(r);
  const d = buildData(p);
  const out = renderTemplate(tmpl, d);
  const left = out.match(/{{[^}]*}}/g);
  const okGroup = out.includes(d.ten_group_aim);
  const okExam = out.includes('>' + d.exam + '<');
  const okLink = out.includes('href="' + d.linknhom + '"');
  const okAim = out.includes('href="' + d.Link_AIM + '"');
  const maCount = d.mabaomatS ? out.split(d.mabaomatS).length - 1 : 0;

  console.log('--- HS ' + (i + 1) + ': ' + p.email);
  console.log('    exam         : ' + d.exam);
  console.log('    ten_group_aim: ' + d.ten_group_aim);
  console.log('    linknhom     : ' + d.linknhom);
  console.log('    mabaomatS    : ' + d.mabaomatS + ' (xuất hiện ' + maCount + ' lần, cần 2)');
  console.log('    Link_AIM     : ' + d.Link_AIM);
  console.log('    render OK    : group=' + okGroup + ' exam=' + okExam + ' linknhom=' + okLink + ' Link_AIM=' + okAim);
  if (left) console.log('    !! còn placeholder: ' + [...new Set(left)].join(', '));

  if (left || !okGroup || !okExam || !okLink || !okAim || maCount !== 2) bad++;
});

console.log(bad === 0
  ? '\nALL OK — ' + samples.length + ' mẫu: không còn placeholder, dữ liệu khớp đúng cột sheet users'
  : '\nCÓ LỖI ở ' + bad + '/' + samples.length + ' mẫu');
process.exit(bad === 0 ? 0 : 1);
