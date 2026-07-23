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

    if (action === 'sendEmail') {
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

// ===== POST action=sendEmail: Gửi email 1 học sinh =====
// Body: { "email": "...", "username": "..." }
function handleSendEmail(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch (parseErr) {
    return json({ ok: false, error: 'Body không phải JSON hợp lệ' });
  }

  var email = (body.email || '').trim();
  var username = (body.username || '').trim();

  if (!email || email.indexOf('@') === -1) {
    return json({ ok: false, error: 'Email không hợp lệ hoặc trống' });
  }

  var subject = '[HOCMAI] Thông tin nhóm học tập của bạn';
  var htmlBody =
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
    '<h2 style="color:#2563eb">Chào ' + (username || 'bạn') + ',</h2>' +
    '<p>Cảm ơn bạn đã đăng ký khoá học tại <b>HOCMAI</b>.</p>' +
    '<p>Vui lòng kiểm tra thông tin nhóm học tập và tham gia nhóm Zalo để nhận thông báo, tài liệu quan trọng từ giáo viên.</p>' +
    '<p style="margin-top:24px;color:#6b7280">Trân trọng,<br><b>HOCMAI</b></p>' +
    '</div>';

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody
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
