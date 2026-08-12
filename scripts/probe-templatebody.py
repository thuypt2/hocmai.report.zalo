#!/usr/bin/env python3
"""Probe: Apps Script deploy có nhận templateBody trong handleSendIndividualEmail không?
Gửi templateBody sẵn + templateKey BAD.
- Nếu Apps Script nhận templateBody (code mới) → gửi OK, không gọi getTemplate
- Nếu code cũ → lỗi 'không tìm thấy template BAD_KEY'
"""
import urllib.request
import json
import time

URL = "https://hocmai-report-zalo.vercel.app/api/send-class-group-email"

payload = {
    "email": "thuypt2@hocmai.vn",
    "username": "probe_tb_retry",
    "templateKey": "BAD_KEY_XYZ_PROBE",
    "templateSubject": "[PROBE] TemplateBody received",
    "templateBody": "<html><body><h1>MARKER_A1B2_TEMPLATEBODY_RECEIVED</h1></body></html>",
    "ma_lop": "LOP",
}

for attempt in range(5):
    try:
        req = urllib.request.Request(
            URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=240) as resp:
            result = json.loads(resp.read().decode())
        if result.get("ok"):
            print(f"Attempt {attempt+1}: OK — Apps Script NHẬN templateBody (gửi thành công, bỏ qua getTemplate)")
            break
        else:
            print(f"Attempt {attempt+1}: FAIL — {result.get('error','')[:120]}")
            if "BAD_KEY" in str(result.get("error", "")):
                print("  → Apps Script KHÔNG nhận templateBody (code cũ, vẫn gọi getTemplate)")
                break
    except Exception as e:
        print(f"Attempt {attempt+1}: EXCEPTION — {str(e)[:120]}")
    time.sleep(3)