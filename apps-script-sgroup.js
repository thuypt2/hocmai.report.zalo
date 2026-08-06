// ============================================================
// Google Apps Script — Topuni S Group Data API
// Copy TOÀN BỘ file này vào Apps Script editor → Deploy as Web App
// Hỗ trợ: ?sheet=users (mặc định), ?sheet=tc_thpt, ?sheet=all (tất cả sheet)
// ============================================================

var SPREADSHEET_ID = '1PaJhe3XUUPoS6miiq9XbJKv9_2kGPdx2KqrdIiGnCHA';
var SHEET_NAME = 'users';
var LOG_SHEET_NAME = 'Email_log';

var MAIN_SPREADSHEET_ID = '199t40ZaH-dHHD8H4toCs8Ze8CoRK8K2B161jbXZNtF4';
var EMAIL_TEMPLATE_SHEET = 'Email_templates';

// ===== Entry points =====
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

// ===== Router =====
function handleRequest(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var sheetParam = (e && e.parameter && e.parameter.sheet) || '';

    if (action === 'sendEmail' || action === 'sendIndividualEmail') {
      return handleSendEmail(e);
    }
    return handleGetData(sheetParam);
  } catch (err) {
    return json({ success: false, error: err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== GET data — hỗ trợ ?sheet=users | ?sheet=tc_thpt | ?sheet=all =====
function handleGetData(sheetParam) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ── ?sheet=all: trả về tất cả các sheet ──
  if (sheetParam === 'all') {
    var allSheets = ss.getSheets();
    var result = [];
    for (var i = 0; i < allSheets.length; i++) {
      var s = allSheets[i];
      var raw = s.getDataRange().getValues();
      result.push({
        sheetName: s.getName(),
        sheetId: s.getSheetId(),
        rows: raw.length,
        columns: raw[0] ? raw[0].length : 0,
        data: raw
      });
    }
    return json({ success: true, spreadsheetId: ss.getId(), spreadsheetName: ss.getName(), totalSheets: result.length, generatedAt: new Date().toISOString(), sheets: result });
  }

  // ── sheet cụ thể hoặc mặc định users ──
  var targetName = sheetParam || SHEET_NAME;
  var sheet = ss.getSheetByName(targetName);
  if (!sheet) {
    // fallback: tìm case-insensitive
    var allS = ss.getSheets();
    for (var i = 0; i < allS.length; i++) {
      if (allS[i].getName().toLowerCase() === targetName.toLowerCase()) { sheet = allS[i]; break; }
    }
  }
  if (!sheet) return json({ success: false, error: 'Không tìm thấy sheet: ' + targetName });

  var rawData = sheet.getDataRange().getValues();
  return json({
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    totalSheets: ss.getSheets().length,
    generatedAt: new Date().toISOString(),
    sheets: [{ sheetName: sheet.getName(), sheetId: sheet.getSheetId(), rows: rawData.length, columns: rawData[0] ? rawData[0].length : 0, data: rawData }]
  });
}

// ===== Gửi email =====
function handleSendEmail(e) {
  var body = {};

  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch (parseErr) {}
  }
  if (!body.email && e && e.parameter) {
    body.email       = e.parameter.email       || '';
    body.username    = e.parameter.username    || '';
    body.linknhom    = e.parameter.linknhom    || '';
    body.mabaomats   = e.parameter.mabaomats   || '';
    body.link_aim    = e.parameter.link_aim    || '';
    body.templateKey = e.parameter.templateKey || '';
    body.imageUrl    = e.parameter.imageUrl    || '';
  }

  var email       = (body.email       || '').trim();
  var username    = (body.username    || '').trim();
  var linknhom    = (body.linknhom    || '').trim();
  var mabaomats   = (body.mabaomats   || '').trim();
  var link_aim    = (body.link_aim    || '').trim();
  var templateKey = (body.templateKey || 'SSC:HDAIM-S').trim();
  var imageUrl    = (body.imageUrl    || '');

  if (!email || email.indexOf('@') === -1) {
    return json({ ok: false, error: 'Email không hợp lệ hoặc trống' });
  }

  var tmpl;
  try { tmpl = getTemplateFromSheet(templateKey); }
  catch (tmplErr) { return json({ ok: false, error: 'Lỗi template: ' + tmplErr.message }); }

  var data = {
    'username': username, 'linknhom': linknhom,
    'mabaomatS': mabaomats, 'Link_AIM': link_aim
  };
  var subject  = renderTemplateText(tmpl.subject, data);
  var htmlBody = renderTemplateText(tmpl.htmlBody, data);

  if (imageUrl) {
    var imageBlock = '<br><br><div style="text-align:center;margin-top:16px">' +
      '<p style="font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px"><b>Hướng dẫn vào nhóm AIM:</b></p>' +
      '<img src="' + imageUrl + '" alt="Hướng dẫn vào AIM" style="max-width:600px;width:100%;border-radius:8px;border:1px solid #e5e7eb">' +
      '</div>';
    var bodyCloseIdx = htmlBody.lastIndexOf('</body>');
    if (bodyCloseIdx >= 0) {
      htmlBody = htmlBody.slice(0, bodyCloseIdx) + imageBlock + htmlBody.slice(bodyCloseIdx);
    } else {
      htmlBody += imageBlock;
    }
  }

  try {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody, name: 'HOCMAI' });
    logEmail(email, username, 'Đã gửi');
    return json({ ok: true, sent: 1, message: 'Đã gửi email cho ' + email, image: imageUrl ? 'ok' : 'khong co' });
  } catch (mailErr) {
    logEmail(email, username, 'Lỗi: ' + mailErr.message);
    return json({ ok: false, error: 'Lỗi gửi email: ' + mailErr.message });
  }
}

// ===== Log =====
function logEmail(email, username, status) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (logSheet) {
      logSheet.appendRow([new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), email, username, status, 'S-group']);
    }
  } catch (e) {}
}

// ===== Đọc template từ Email_templates =====
function getTemplateFromSheet(templateKey) {
  var ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EMAIL_TEMPLATE_SHEET);
  if (!sheet) {
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === EMAIL_TEMPLATE_SHEET.toLowerCase()) { sheet = allSheets[i]; break; }
    }
  }
  if (!sheet) throw new Error('Không tìm thấy sheet ' + EMAIL_TEMPLATE_SHEET);

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error('Sheet ' + EMAIL_TEMPLATE_SHEET + ' chưa có dữ liệu');

  var headers = values[0];
  var rows = values.slice(1);

  function findCol(names) {
    for (var h = 0; h < headers.length; h++) {
      var hn = String(headers[h] || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      for (var n = 0; n < names.length; n++) {
        if (hn === names[n].toLowerCase().replace(/[\s_]+/g, '')) return h;
      }
    }
    return -1;
  }

  var keyIdx = findCol(['template_key', 'templatekey', 'key', 'ma_mau']);
  var subjectIdx = findCol(['subject', 'chu_de', 'ten_mau']);
  var bodyIdx = findCol(['html_body', 'htmlbody', 'noi_dung_html']);

  if (keyIdx === -1 || subjectIdx === -1 || bodyIdx === -1) {
    throw new Error('Sheet thiếu cột. Cần: template_key, subject, html_body');
  }

  var foundRow = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyIdx] || '').trim() === templateKey) { foundRow = rows[i]; break; }
  }
  if (!foundRow) throw new Error('Không tìm thấy template key="' + templateKey + '"');

  return { subject: String(foundRow[subjectIdx] || ''), htmlBody: String(foundRow[bodyIdx] || '') };
}

// ===== Render template =====
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