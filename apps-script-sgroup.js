// ============================================================
// Google Apps Script — Topuni S Group Data API
// Copy toàn bộ file này vào Apps Script editor → Deploy
// ============================================================
// Sheet cần có: "users" với các cột:
//   A: username    B: student_hmid (UserID)
//   C: phone (SĐT) D: email
//   F: product_id  J: mabaomatS
//   L: linknhom    M: maillan1
//   S: Trạng thái bắn noti   X: Trạng thái duyệt
// ============================================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'sendEmail') {
      return handleSendEmail(e);
    }

    // Mặc định: trả về dữ liệu sheet users
    return handleGetData();
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Lấy dữ liệu từ sheet users =====
function handleGetData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('users');

  if (!sheet) {
    return jsonResponse({
      success: false,
      error: 'Không tìm thấy sheet "users". Vui lòng tạo sheet có tên chính xác là "users".'
    });
  }

  const data = sheet.getDataRange().getValues();
  const spreadsheetId = ss.getId();
  const spreadsheetName = ss.getName();

  return jsonResponse({
    success: true,
    spreadsheetId: spreadsheetId,
    spreadsheetName: spreadsheetName,
    totalSheets: ss.getSheets().length,
    generatedAt: new Date().toISOString(),
    sheets: [{
      sheetName: 'users',
      sheetId: sheet.getSheetId(),
      rows: data.length,
      columns: data[0] ? data[0].length : 0,
      data: data
    }]
  });
}

// ===== Gửi email (từ tab 2.2 Nhóm S) =====
// POST body: { action: "sendEmail", email, username }
function handleSendEmail(e) {
  const body = e && e.postData ? JSON.parse(e.postData.contents) : {};
  const email = body.email || '';
  const username = body.username || '';

  if (!email || !email.includes('@')) {
    return jsonResponse({ ok: false, error: 'Email không hợp lệ' });
  }

  const subject = '[HOCMAI] Thông tin nhóm học tập của bạn';
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#2563eb">Chào ${username || 'bạn'},</h2>
      <p>Cảm ơn bạn đã đăng ký khoá học tại HOCMAI.</p>
      <p>Vui lòng kiểm tra thông tin nhóm học tập và tham gia nhóm Zalo để nhận thông báo quan trọng.</p>
      <p style="margin-top:24px">Trân trọng,<br><b>HOCMAI</b></p>
    </div>`;

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody,
    });

    // Log vào sheet Email_log nếu có
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const logSheet = ss.getSheetByName('Email_log');
      if (logSheet) {
        logSheet.appendRow([
          new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
          email,
          username || '',
          'Đã gửi',
          'S-group individual'
        ]);
      }
    } catch (logErr) {
      // Không có sheet log cũng không sao
    }

    return jsonResponse({
      ok: true,
      sent: 1,
      message: `Đã gửi email cho ${email}`
    });

  } catch (mailErr) {
    return jsonResponse({
      ok: false,
      error: 'Lỗi gửi email: ' + mailErr.message
    });
  }
}
