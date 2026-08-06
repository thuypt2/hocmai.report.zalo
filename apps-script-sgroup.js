// ============================================================
// Google Apps Script — Topuni S Group Data API
// Copy TOÀN BỘ file này vào Apps Script editor → Deploy as Web App
//
// Cách deploy:
//   1. Vào script.google.com (hoặc Extensions → Apps Script từ Sheet)
//   2. Dán toàn bộ code này vào
//   3. Deploy → New Deployment → Type: Web app
//      Execute as: Me
//      Who has access: Anyone
//   4. Copy URL deploy đưa cho team
//
// Sheet "users" cần các cột:
//   A: username    B: student_hmid (UserID)
//   C: phone       D: email
//   F: product_id  J: mabaomatS
//   L: linknhom    M: maillan1
//   S: Trạng thái bắn noti   X: Trạng thái duyệt
// ============================================================

var SPREADSHEET_ID = '1PaJhe3XUUPoS6miiq9XbJKv9_2kGPdx2KqrdIiGnCHA';
var SHEET_NAME = 'users';
var LOG_SHEET_NAME = 'Email_log';

// ── Đọc template từ sheet Email_templates của spreadsheet CHÍNH ──
var MAIN_SPREADSHEET_ID = '199t40ZaH-dHHD8H4toCs8Ze8CoRK8K2B161jbXZNtF4';
var EMAIL_TEMPLATE_SHEET = 'Email_templates';

// ===== Entry points =====
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

// ===== Router =====
function handleRequest(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'sendEmail' || action === 'sendIndividualEmail') {
      return handleSendEmail(e);
    }

    // Mặc định: trả về toàn bộ dữ liệu sheet users
    return handleGetData();
  } catch (err) {
    return json({ success: false, error: err.message });
  }
}

// ===== JSON response helper =====
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== GET: Lấy dữ liệu từ sheet users =====
function handleGetData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    return json({
      success: false,
      error: 'Không tìm thấy sheet "' + SHEET_NAME + '" trong spreadsheet ' + SPREADSHEET_ID
    });
  }

  var rawData = sheet.getDataRange().getValues();

  return json({
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    totalSheets: ss.getSheets().length,
    generatedAt: new Date().toISOString(),
    sheets: [{
      sheetName: SHEET_NAME,
      sheetId: sheet.getSheetId(),
      rows: rawData.length,
      columns: rawData[0] ? rawData[0].length : 0,
      data: rawData
    }]
  });
}

// ===== POST action=sendEmail / sendIndividualEmail: Gửi email 1 học sinh =====
// Dùng template từ sheet Email_templates cột C (html_body)
function handleSendEmail(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch (parseErr) {
    return json({ ok: false, error: 'Body không phải JSON hợp lệ' });
  }

  var email       = (body.email       || '').trim();
  var username    = (body.username    || '').trim();
  var linknhom    = (body.linknhom    || '').trim();
  var mabaomats   = (body.mabaomats   || '').trim();
  var link_aim    = (body.link_aim    || '').trim();
  var templateKey = (body.templateKey || 'SSC:HDAIM-S').trim();

  if (!email || email.indexOf('@') === -1) {
    return json({ ok: false, error: 'Email không hợp lệ hoặc trống' });
  }

  // ── Đọc template từ sheet Email_templates của spreadsheet chính ──
  var tmpl;
  try {
    tmpl = getTemplateFromSheet(templateKey);
  } catch (tmplErr) {
    return json({ ok: false, error: 'Lỗi template: ' + tmplErr.message });
  }

  // Thay thế placeholder trong subject và html_body (cột C)
  var data = {
    'username':   username,
    'linknhom':   linknhom,
    'mabaomatS':  mabaomats,
    'Link_AIM':   link_aim,
  };
  var subject  = renderTemplateText(tmpl.subject, data);
  var htmlBody = renderTemplateText(tmpl.htmlBody, data);

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody,
      name: 'HOCMAI',
    });

    // Log vào Email_log nếu có sheet đó
    logEmail(email, username, 'Đã gửi');

    return json({
      ok: true,
      sent: 1,
      message: 'Đã gửi email cho ' + email
    });

  } catch (mailErr) {
    // Log lỗi
    logEmail(email, username, 'Lỗi: ' + mailErr.message);

    return json({
      ok: false,
      error: 'Lỗi gửi email: ' + mailErr.message
    });
  }
}

// ===== Ghi log vào sheet Email_log =====
function logEmail(email, username, status) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (logSheet) {
      logSheet.appendRow([
        new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        email,
        username,
        status,
        'S-group'
      ]);
    }
  } catch (e) {
    // Không có sheet log cũng không sao, bỏ qua
  }
}

// ===== Đọc template từ sheet Email_templates (spreadsheet chính) =====
// Column A: template_key, Column B: subject, Column C: html_body
function getTemplateFromSheet(templateKey) {
  var ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);

  // Tìm sheet Email_templates (case-insensitive)
  var sheet = ss.getSheetByName(EMAIL_TEMPLATE_SHEET);
  if (!sheet) {
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === EMAIL_TEMPLATE_SHEET.toLowerCase()) {
        sheet = allSheets[i];
        break;
      }
    }
  }

  if (!sheet) {
    throw new Error('Không tìm thấy sheet "' + EMAIL_TEMPLATE_SHEET + '" trong spreadsheet chính');
  }

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    throw new Error('Sheet "' + EMAIL_TEMPLATE_SHEET + '" chưa có dữ liệu');
  }

  var headers = values[0];
  var rows = values.slice(1);

  // Tìm chỉ số cột: template_key (A), subject (B), html_body (C)
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

  if (keyIdx === -1 || subjectIdx === -1 || bodyIdx === -1) {
    throw new Error('Sheet thiếu cột. Hiện có: ' + headers.join(', ') + '. Cần: template_key, subject, html_body');
  }

  // Tìm template khớp key
  var foundRow = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rowKey = String(r[keyIdx] || '').trim();
    if (rowKey !== templateKey) continue;
    foundRow = r;
    break;
  }

  if (!foundRow) {
    var available = [];
    for (var j = 0; j < rows.length; j++) {
      var rk = String(rows[j][keyIdx] || '').trim();
      if (rk) available.push(rk);
    }
    throw new Error('Không tìm thấy template key="' + templateKey + '". Các template: ' + available.join(', '));
  }

  return {
    subject:  String(foundRow[subjectIdx] || ''),
    htmlBody: String(foundRow[bodyIdx] || ''),
  };
}

// ===== Render template: thay {{key}} bằng giá trị thực =====
function renderTemplateText(text, data) {
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
