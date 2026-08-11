// ============================================================
// Google Apps Script — HOCMAI Report Zalo (v3)
// Deploy tại: hocmai-report-zalo.vercel.app
// 
// Hỗ trợ:
//   doGet:
//     ?action=listSheets                    → liệt kê sheet
//     ?action=getAllSpreadsheetData&sheet=X → đọc sheet bất kỳ
//     ?sheet=Wait_member                    → học sinh chờ duyệt
//     (mặc định)                            → TopUni2_Data
//   doPost:
//     sendIndividualEmail                   → gửi 1 email + log Email_Log
//     sendClassGroupEmails                  → gửi batch (Email_Queue hoặc selectedEmails)
//     createAccount / updateAccount / deleteAccount → quản trị
// ============================================================

var CONFIG = {
  // ID của Google Sheet (copy từ URL: https://docs.google.com/spreadsheets/d/<ID>/edit)
  SPREADSHEET_ID: '199t40ZaH-dHHD8H4toCs8Ze8CoRK8K2B161jbXZNtF4',

  DATA_SHEET: 'TopUni2_Data',
  EMAIL_TEMPLATE_SHEET: 'Email_templates',  // tên thật trong sheet (lowercase t)
  EMAIL_LOG_SHEET: 'Email_Log',
  EMAIL_QUEUE_SHEET: 'Email_Queue',
  ACCOUNTS_SHEET: 'Accounts',
  WAIT_MEMBER_SHEETS: ['Waiting_member', 'Wait_member', 'Wating_member', 'waiting_member'],

  SECRET: '@Hocmai123',
  ACCOUNTS_SECRET: '@HocmaiAdmin2026',
  TEMPLATE_KEY: 'SSC:HD130',
};

// ===== Entry points =====
function doGet(e) {
  return handleGet(e);
}

function doPost(e) {
  return handlePost(e);
}

// ============================================================
// GET router
// ============================================================
function handleGet(e) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var action = (e && e.parameter && e.parameter.action) || '';
    var sheetParam = (e && e.parameter && e.parameter.sheet) || '';

    // ── action=listSheets ──
    if (action === 'listSheets') {
      var names = ss.getSheets().map(function(s) { return s.getName(); });
      return jsonOutput({ ok: true, sheets: names });
    }

    // ── action=getAllSpreadsheetData: đọc sheet bất kỳ (dùng cho Email_Templates, Email_Log) ──
    if (action === 'getAllSpreadsheetData') {
      return handleGetSheet(ss, sheetParam);
    }

    // ── action=getAccounts / verifyLogin / quản trị tài khoản (qua GET) ──
    if (action === 'getAccounts' || action === 'verifyLogin' ||
        action === 'createAccount' || action === 'updateAccount' || action === 'deleteAccount') {
      return handleAccountsGet(ss, e);
    }

    // ── sheet=Wait_member ──
    if (sheetParam === 'Wait_member' || sheetParam === 'wait_member' ||
        sheetParam === 'Wating_member' || sheetParam === 'waiting_member') {
      return handleWaitMember(ss);
    }

    // ── Mặc định: TopUni2_Data ──
    return handleGetSheet(ss, CONFIG.DATA_SHEET);

  } catch (err) {
    return jsonError('doGet LOI: ' + err.message);
  }
}

// ===== Đọc sheet bất kỳ và trả JSON =====
function handleGetSheet(ss, sheetName) {
  if (!sheetName) sheetName = CONFIG.DATA_SHEET;

  // Thử tìm với exact match trước, rồi case-insensitive
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // fallback: tìm case-insensitive
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === sheetName.toLowerCase()) {
        sheet = allSheets[i];
        break;
      }
    }
  }

  if (!sheet) {
    var availableNames = ss.getSheets().map(function(s) { return s.getName(); }).join(', ');
    return jsonOutput({
      ok: false,
      error: 'Khong tim thay sheet "' + sheetName + '". Cac sheet hien co: ' + availableNames
    });
  }

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    return jsonOutput({ ok: true, total: 0, data: [] });
  }

  var headers = values[0];
  var rows = values.slice(1);
  var data = rows.map(function(row) {
    var item = {};
    headers.forEach(function(header, idx) {
      item[header] = row[idx] || '';
    });
    return item;
  });

  return jsonOutput({ ok: true, total: data.length, sheetName: sheet.getName(), data: data });
}

// ===== Wait_member =====
function handleWaitMember(ss) {
  var waitSheet = null;
  for (var i = 0; i < CONFIG.WAIT_MEMBER_SHEETS.length; i++) {
    waitSheet = ss.getSheetByName(CONFIG.WAIT_MEMBER_SHEETS[i]);
    if (waitSheet) break;
  }
  if (!waitSheet) {
    var allNames = ss.getSheets().map(function(s) { return s.getName(); }).join(', ');
    return jsonOutput({ ok: false, error: 'Khong tim thay sheet waiting. Cac sheet: ' + allNames });
  }

  var values = waitSheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    return jsonOutput({ ok: true, total: 0, data: [] });
  }

  var headers = values[0];
  var rows = values.slice(1);
  var data = rows.map(function(row, idx) {
    var item = { stt: idx + 1 };
    headers.forEach(function(header, i) {
      item[header] = row[i] || '';
    });
    return item;
  });

  return jsonOutput({ ok: true, total: data.length, data: data });
}

// ===== Account management (GET) =====
function handleAccountsGet(ss, e) {
  var action = e.parameter.action;
  if (action === 'verifyLogin') {
    if (e.parameter.secret !== CONFIG.ACCOUNTS_SECRET) return jsonError('Sai secret quan tri');
    var uname = String(e.parameter.username || '').trim();
    var pwd = String(e.parameter.password || '');
    if (!uname || !pwd) return jsonError('Thieu username hoac password');
    var accounts = readAccountsFromSheet(ss);
    var acc = null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].username === uname) { acc = accounts[i]; break; }
    }
    if (!acc) return jsonOutput({ ok: false, error: 'Tai khoan khong ton tai' });
    if (!acc.active) return jsonOutput({ ok: false, error: 'Tai khoan da bi khoa' });
    var hashed = sha256Gs(pwd);
    if (acc.password_hash !== hashed) return jsonOutput({ ok: false, error: 'Sai mat khau' });
    return jsonOutput({ ok: true, role: acc.role, name: acc.name, email: acc.email });
  }

  if (e.parameter.secret !== CONFIG.ACCOUNTS_SECRET) return jsonError('Sai secret quan tri');

  if (action === 'getAccounts') {
    var includeHash = e.parameter.includeHash === '1';
    var accounts = readAccountsFromSheet(ss).map(function(a) {
      var rec = { username: a.username, role: a.role, name: a.name, email: a.email, active: a.active };
      if (includeHash) rec.password_hash = a.password_hash;
      return rec;
    });
    return jsonOutput({ ok: true, accounts: accounts });
  }

  var body = {
    username: e.parameter.username,
    password: e.parameter.password,
    role: e.parameter.role,
    name: e.parameter.name,
    email: e.parameter.email,
    active: e.parameter.active !== 'false',
  };
  if (action === 'createAccount') return handleCreateAccount(ss, body);
  if (action === 'updateAccount') return handleUpdateAccount(ss, body);
  if (action === 'deleteAccount') return handleDeleteAccount(ss, { username: e.parameter.username });

  return jsonError('Unknown action: ' + action);
}

// ============================================================
// POST router
// ============================================================
function handlePost(e) {
  try {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonError('Khong parse duoc JSON body');
    }

    if (body.secret !== CONFIG.SECRET &&
        body.action !== 'createAccount' && body.action !== 'updateAccount' && body.action !== 'deleteAccount') {
      return jsonError('Sai secret');
    }

    if (body.action === 'sendIndividualEmail') {
      return handleSendIndividualEmail(body);
    }

    if (body.action === 'sendClassGroupEmails') {
      return handleSendClassGroupEmails(body);
    }

    // Account management
    if (body.action === 'createAccount' || body.action === 'updateAccount' || body.action === 'deleteAccount') {
      if (body.secret !== CONFIG.ACCOUNTS_SECRET) return jsonError('Sai secret quan tri');
      var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      if (body.action === 'createAccount') return handleCreateAccount(ss, body);
      if (body.action === 'updateAccount') return handleUpdateAccount(ss, body);
      if (body.action === 'deleteAccount') return handleDeleteAccount(ss, body);
    }

    return jsonError('Unknown action: ' + body.action);

  } catch (err) {
    return jsonError('doPost LOI: ' + err.message);
  }
}

// ============================================================
// HANDLER: Gửi 1 email cá nhân (có log vào Email_Log)
// ============================================================
function handleSendIndividualEmail(body) {
  var email       = body.email       || '';
  var username    = body.username    || '';
  var ma_lop      = body.ma_lop      || '';
  var exam        = body.exam        || '';
  var gv          = body.gv          || '';
  var link_group  = body.link_group  || '';
  var sdt_gv      = body.sdt_gv      || '';
  var ma_bao_mat  = body.ma_bao_mat  || '';
  var nhom_aim    = body.nhom_aim    || '';
  var link_aim    = body.link_aim    || '';
  var final_phone = body.final_phone || '';
  // SSC:HDAIM-S fields
  var tencongdong = body.tencongdong || '';
  var linknhom    = body.linknhom    || '';
  var mabaomats   = body.mabaomats   || '';

  if (!email || email.indexOf('@') === -1) {
    return jsonError('Thieu email hoac email khong hop le');
  }

  // Lấy template từ sheet Email_templates
  var tmpl;
  try {
    tmpl = getTemplate(body.templateKey || CONFIG.TEMPLATE_KEY);
  } catch (tmplErr) {
    return jsonError('Loi template: ' + tmplErr.message);
  }

  // Các key placeholder — phải khớp với {{key}} trong template html_body
  var data = {
    'Mã lớp':     ma_lop,
    'GV':         gv,
    'exam':       exam,
    'link group': link_group,
    'Link_AIM':   link_aim,
    'SĐT GV':     sdt_gv,
    'Mã bảo mật': ma_bao_mat,
    'Nhom_AIM':   nhom_aim,
    'username':   username,
    'finalphone': final_phone,
    // SSC:HDAIM-S placeholders
    'tencongdong': tencongdong,
    'linknhom':    linknhom,
    'mabaomatS':   mabaomats,
  };

  var subject = renderTemplate(tmpl.subject, data);
  var htmlBody = renderTemplate(tmpl.htmlBody, data);

  // Chỉ tab 2.2 (template SSC:HDAIM-S) hiển thị sender HOCMAI; các tab khác giữ nguyên
  var senderName = (body.templateKey === 'SSC:HDAIM-S') ? 'HOCMAI' : 'Giáo viên chủ nhiệm';

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody,
      name: senderName,
    });

    // GHI LOG vào Email_Log
    logToEmailLog(email, username, ma_lop, exam, gv, link_group, link_aim, sdt_gv, final_phone, 'Da gui - ca nhan');

    return jsonOutput({
      ok: true,
      message: 'Da gui email toi ' + email,
    });
  } catch (mailErr) {
    // Vẫn log lỗi
    logToEmailLog(email, username, ma_lop, exam, gv, link_group, link_aim, sdt_gv, final_phone, 'Loi: ' + mailErr.message);
    return jsonError('Khong gui duoc email toi ' + email + ': ' + mailErr.message);
  }
}

// ============================================================
// HANDLER: Gửi email hàng loạt
// Hỗ trợ:
//   (A) selectedEmails + selectedStudents (từ tab 2.2 Gửi email nhắc nhở)
//   (B) Email_Queue (từ batch admin)
// ============================================================
function handleSendClassGroupEmails(body) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // ── (A) Gửi từ danh sách selected (tab 2.2) ──
  if (body.selectedEmails && body.selectedEmails.length > 0) {
    return handleSendSelectedEmails(ss, body);
  }

  // ── (B) Gửi từ Email_Queue ──
  return handleSendFromQueue(ss, body);
}

// ===== (A) Gửi selected emails từ tab 2.2 =====
function handleSendSelectedEmails(ss, body) {
  var selectedEmails = body.selectedEmails || [];
  var selectedStudents = body.selectedStudents || [];
  var templateKey = body.templateKey || CONFIG.TEMPLATE_KEY;
  var templateSubject = body.templateSubject || '';
  var templateBody = body.templateBody || '';

  if (selectedEmails.length === 0) {
    return jsonOutput({ ok: true, sent: 0, errors: 0, message: 'Danh sach trong' });
  }

  // Nếu có templateBody được truyền từ client, dùng luôn (đã render sẵn)
  // Ngược lại lấy từ sheet
  var useCustomTemplate = !!templateBody;

  var sent = 0;
  var errors = 0;
  var sentIds = [];
  var logIds = [];
  var errorDetails = [];
  var limit = Math.min(body.limit || 200, selectedEmails.length);

  for (var i = 0; i < limit; i++) {
    var email = (selectedEmails[i] || '').trim();
    var student = selectedStudents[i] || {};

    if (!email || email.indexOf('@') === -1) {
      errors++;
      errorDetails.push({ email: email, error: 'Email khong hop le' });
      continue;
    }

    try {
      var data = {
        'Mã lớp':     student.ma_lop   || '',
        'GV':         student.gv       || '',
        'exam':       student.exam     || '',
        'link group': student.link_group || '',  // sẽ được enrich từ DB nếu có
        'Link_AIM':   student.link_aim   || '',
        'SĐT GV':     student.sdt_gv     || '',
        'Mã bảo mật': student.ma_bao_mat || '',
        'Nhom_AIM':   student.nhom_aim   || '',
        'username':   student.username   || '',
        'finalphone': student.final_phone || '',
        // SSC:HDAIM-S placeholders
        'tencongdong': student.tencongdong || '',
        'linknhom':    student.linknhom    || '',
        'mabaomatS':   student.mabaomats   || '',
      };

      var subject, htmlBody;
      if (useCustomTemplate) {
        subject = renderTemplate(templateSubject, data);
        htmlBody = renderTemplate(templateBody, data);
      } else {
        var tmpl = getTemplate(templateKey);
        subject = renderTemplate(tmpl.subject, data);
        htmlBody = renderTemplate(tmpl.htmlBody, data);
      }

      // Chỉ tab 2.2 (template SSC:HDAIM-S) hiển thị sender HOCMAI; các tab khác giữ nguyên
      var senderName = (templateKey === 'SSC:HDAIM-S') ? 'HOCMAI' : 'Giáo viên chủ nhiệm';
      MailApp.sendEmail({
        to: email,
        subject: subject,
        htmlBody: htmlBody,
        name: senderName,
      });

      // Log
      var logKey = logToEmailLog(email, data.username, data['Mã lớp'], student.exam || '',
                                  data.GV, data['link group'], data.Link_AIM,
                                  data['SĐT GV'], data.finalphone, 'Da gui - batch tab2.2');
      if (logKey) logIds.push(logKey);
      sentIds.push(email);
      sent++;

    } catch (mailErr) {
      errors++;
      errorDetails.push({ email: email, error: mailErr.message });
      logToEmailLog(email, data && data.username || '', data && data['Mã lớp'] || '',
                     student.exam || '', data && data.GV || '',
                     data && data['link group'] || '', data && data.Link_AIM || '',
                     data && data['SĐT GV'] || '', data && data.finalphone || '',
                     'Loi: ' + mailErr.message);
    }

    // Nghỉ 100ms giữa các email để tránh quota
    if (i < limit - 1) Utilities.sleep(100);
  }

  return jsonOutput({
    ok: true,
    sent: sent,
    errors: errors,
    sent_ids: sentIds,
    log_ids: logIds,
    remainingQuota: MailApp.getRemainingDailyQuota(),
    errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
  });
}

// ===== (B) Gửi từ Email_Queue =====
function handleSendFromQueue(ss, body) {
  var q = ss.getSheetByName(CONFIG.EMAIL_QUEUE_SHEET);
  if (!q) {
    return jsonError('Khong tim thay sheet "' + CONFIG.EMAIL_QUEUE_SHEET + '"');
  }

  var tmpl;
  try {
    tmpl = getTemplate(CONFIG.TEMPLATE_KEY);
  } catch (tmplErr) {
    return jsonError('Loi template: ' + tmplErr.message);
  }

  var queueData = q.getDataRange().getDisplayValues();
  if (queueData.length < 2) {
    return jsonOutput({ ok: true, sent: 0, errors: 0, message: 'Email_Queue trong' });
  }

  var rows = queueData.slice(1);
  var sent = 0;
  var errors = 0;
  var errorDetails = [];
  var limit = body.limit || 50;

  for (var i = 0; i < Math.min(rows.length, limit); i++) {
    var row = rows[i];
    var email = (row[0] || '').trim();
    var status = (row[1] || '').trim();

    if (!email) continue;
    if (status === 'Da gui') continue;

    try {
      var data = {
        'Mã lớp':     row[3] || '',
        'GV':         row[2] || '',
        'link group': row[4] || '',
        'Link_AIM':   row[5] || '',
      };

      var subject = renderTemplate(tmpl.subject, data);
      var htmlBody = renderTemplate(tmpl.htmlBody, data);

      MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody, name: 'Giáo viên chủ nhiệm' });

      q.getRange(i + 2, 2).setValue('Da gui');

      // Log
      logToEmailLog(email, '', data['Mã lớp'], '', data.GV, data['link group'],
                     data.Link_AIM, '', '', 'Da gui - queue');

      sent++;
    } catch (e) {
      q.getRange(i + 2, 2).setValue('Loi: ' + e.message.slice(0, 100));
      errors++;
      errorDetails.push({ email: email, error: e.message });
    }
  }

  return jsonOutput({
    ok: true,
    sent: sent,
    errors: errors,
    remainingQuota: MailApp.getRemainingDailyQuota(),
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
  });
}

// ============================================================
// GHI LOG vào Email_Log
// ============================================================
function logToEmailLog(email, username, maLop, exam, gv, linkGroup, linkAim, sdtGv, finalPhone, status) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var logSheet = ss.getSheetByName(CONFIG.EMAIL_LOG_SHEET);

    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.EMAIL_LOG_SHEET);
      logSheet.getRange(1, 1, 1, 10).setValues([[
        'Email', 'Trang thai', 'Thoi gian', 'Username', 'Ma lop',
        'Exam', 'GV', 'Link group', 'Link_AIM', 'SDT GV'
      ]]);
      logSheet.setFrozenRows(1);
    }

    var now = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var timestamp = pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + now.getFullYear() +
                    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    logSheet.appendRow([
      email, status, timestamp, username, maLop,
      exam, gv, linkGroup, linkAim, sdtGv
    ]);

    return timestamp; // trả về để UI hiển thị
  } catch (err) {
    console.error('Ghi Email_Log that bai: ' + err.message);
    return null;
  }
}

// ============================================================
// TEMPLATE: Đọc từ sheet Email_templates
// ============================================================
var TEMPLATE_CONTENT_API = 'https://hocmai-report-zalo.vercel.app/api/template-content';

/**
 * Nếu htmlBody là đường dẫn file (chứa \\ hoặc / hoặc kết thúc .txt),
 * fetch nội dung từ Vercel API. Ngược lại trả về nguyên bản.
 */
function resolveTemplateContent(content) {
  if (!content) return '';
  var trimmed = String(content).trim();
  // Kiểm tra có phải đường dẫn file không
  if (/[\\\\/]/.test(trimmed) || trimmed.endsWith('.txt')) {
    var filename = trimmed.split(/[\\\\/]/).pop(); // lấy tên file cuối cùng
    try {
      var url = TEMPLATE_CONTENT_API + '?name=' + encodeURIComponent(filename);
      var resp = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (resp.getResponseCode() === 200) {
        return resp.getContentText();
      }
      console.warn('Template content API returned ' + resp.getResponseCode() + ' for ' + filename);
    } catch (e) {
      console.error('Failed to fetch template content: ' + e.message);
    }
    return trimmed; // fallback: trả về đường dẫn (sẽ không hiển thị đẹp nhưng không crash)
  }
  return trimmed;
}

function getTemplate(templateKey) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Tìm sheet với tên chính xác hoặc case-insensitive
  var sheet = ss.getSheetByName(CONFIG.EMAIL_TEMPLATE_SHEET);
  if (!sheet) {
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === CONFIG.EMAIL_TEMPLATE_SHEET.toLowerCase()) {
        sheet = allSheets[i];
        break;
      }
    }
  }

  if (!sheet) {
    throw new Error('Khong tim thay sheet "' + CONFIG.EMAIL_TEMPLATE_SHEET + '"');
  }

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    throw new Error('Sheet "' + CONFIG.EMAIL_TEMPLATE_SHEET + '" chua co du lieu');
  }

  var headers = values[0];
  var rows = values.slice(1);

  // Tìm chỉ số cột: template_key (col A), subject (col B), html_body (col C), active (col D)
  function findCol(names) {
    for (var h = 0; h < headers.length; h++) {
      var hn = String(headers[h] || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      for (var n = 0; n < names.length; n++) {
        if (hn === names[n].toLowerCase().replace(/[\s_]+/g, '')) return h;
      }
    }
    return -1;
  }

  var keyIdx     = findCol(['template_key', 'templatekey', 'TemplateKey', 'key', 'ma_mau']);
  var subjectIdx = findCol(['subject', 'Subject', 'chu_de', 'Chu de', 'ten_mau']);
  var bodyIdx    = findCol(['html_body', 'Html_body', 'HTML_body', 'htmlBody', 'noi_dung_html']);
  var activeIdx  = findCol(['active', 'Active', 'hoat_dong']);

  if (keyIdx === -1 || subjectIdx === -1 || bodyIdx === -1) {
    throw new Error('Sheet thieu cot. Hien co: ' + headers.join(', ') + '. Can: template_key, subject, html_body');
  }

  // Tìm template khớp key, active=true nếu có cột active
  var foundRow = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rowKey = String(r[keyIdx] || '').trim();
    if (rowKey !== templateKey) continue;

    // Nếu có cột active, chỉ lấy active=true
    if (activeIdx >= 0) {
      if (String(r[activeIdx] || '').trim().toUpperCase() !== 'TRUE') continue;
    }
    foundRow = r;
    break;
  }

  if (!foundRow) {
    var available = [];
    for (var j = 0; j < rows.length; j++) {
      var rk = String(rows[j][keyIdx] || '').trim();
      var ra = activeIdx >= 0 ? String(rows[j][activeIdx] || '').trim() : 'N/A';
      if (rk) available.push(rk + ' (' + ra + ')');
    }
    throw new Error('Khong tim thay template key="' + templateKey + '" dang active.\nCac template: ' + available.join(', '));
  }

  return {
      subject: String(foundRow[subjectIdx] || ''),
      htmlBody: resolveTemplateContent(String(foundRow[bodyIdx] || '')),
    };
}

// ============================================================
// RENDER TEMPLATE: thay {{key}} bằng giá trị
// ============================================================
function renderTemplate(text, data) {
  var result = text || '';
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = data[key] || '';
    var escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = new RegExp('{{\\s*' + escapedKey + '\\s*}}', 'gi');
    result = result.replace(pattern, value);
  }
  return result;
}

// ============================================================
// ACCOUNT MANAGEMENT
// ============================================================
function readAccountsFromSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.ACCOUNTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ACCOUNTS_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['username', 'password_hash', 'role', 'name', 'email', 'active']]);
    sheet.getRange(2, 1, 1, 6).setValues([['admin', sha256Gs('@Hocmai2026Admin'), 'admin', 'Quan tri vien', '', 'TRUE']]);
  }
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0].map(function(h) { return String(h).trim(); });
  return vals.slice(1).map(function(row) {
    var acc = {};
    headers.forEach(function(h, i) { acc[h] = String(row[i] || ''); });
    acc.active = (String(acc.active).toUpperCase() === 'TRUE');
    return acc;
  });
}

function writeAccountsToSheet(ss, accounts) {
  var sheet = ss.getSheetByName(CONFIG.ACCOUNTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ACCOUNTS_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['username', 'password_hash', 'role', 'name', 'email', 'active']]);
  }
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  if (accounts.length > 0) {
    var rows = accounts.map(function(a) {
      return [a.username || '', a.password_hash || '', a.role || '', a.name || '', a.email || '', a.active ? 'TRUE' : 'FALSE'];
    });
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
}

function handleCreateAccount(ss, body) {
  var username = String(body.username || '').trim();
  var password = String(body.password || '');
  var role = String(body.role || 'dvkh').trim();
  var name = String(body.name || '').trim();
  var email = String(body.email || '').trim();
  var active = body.active !== false;

  if (!username) return jsonError('username la bat buoc');
  if (!password) return jsonError('password la bat buoc');

  var accounts = readAccountsFromSheet(ss);
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].username === username) return jsonError('Tai khoan "' + username + '" da ton tai');
  }
  accounts.push({
    username: username,
    password_hash: sha256Gs(password),
    role: role,
    name: name,
    email: email,
    active: active,
  });
  writeAccountsToSheet(ss, accounts);
  return jsonOutput({ ok: true, message: 'Da tao tai khoan ' + username });
}

function handleUpdateAccount(ss, body) {
  var username = String(body.username || '').trim();
  if (!username) return jsonError('username la bat buoc');
  var accounts = readAccountsFromSheet(ss);
  var found = false;
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].username === username) {
      if (body.password) accounts[i].password_hash = sha256Gs(String(body.password));
      if (body.role !== undefined) accounts[i].role = String(body.role).trim();
      if (body.name !== undefined) accounts[i].name = String(body.name).trim();
      if (body.email !== undefined) accounts[i].email = String(body.email).trim();
      if (body.active !== undefined) accounts[i].active = body.active;
      found = true;
      break;
    }
  }
  if (!found) return jsonError('Khong tim thay tai khoan ' + username);
  writeAccountsToSheet(ss, accounts);
  return jsonOutput({ ok: true, message: 'Da cap nhat tai khoan ' + username });
}

function handleDeleteAccount(ss, body) {
  var username = String(body.username || '').trim();
  if (!username) return jsonError('username la bat buoc');
  var accounts = readAccountsFromSheet(ss);
  var newList = [];
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].username !== username) newList.push(accounts[i]);
  }
  writeAccountsToSheet(ss, newList);
  return jsonOutput({ ok: true, message: 'Da xoa tai khoan ' + username });
}

// ============================================================
// UTILS
// ============================================================
function sha256Gs(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return jsonOutput({ ok: false, error: message });
}
