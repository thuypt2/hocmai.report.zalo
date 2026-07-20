# hocmai.report.zalo

Báo cáo Zalo - HOCMAI

Trang báo cáo live deploy trên Vercel. Frontend load dữ liệu qua các API route
trong `api/`. Dữ liệu báo cáo chính được lấy qua TopUni2 data API.

## Cấu trúc

```text
.
├── index.html         # Frontend báo cáo chính (self-contained)
├── api/
│   ├── auth.js        # Login/JWT/quản trị tài khoản
│   └── get-data.js    # Gọi TopUni2 data API và tính KPI
├── vercel.json        # Cấu hình Vercel
└── README.md
```

## Báo cáo gồm 2 tab

**Tab 1 - TỔNG QUAN:**
- 1.1 Thống kê theo kỳ thi (KPI cards + bảng chi tiết)
- 1.2 Biểu đồ theo tháng (line chart)
- 1.3 Danh sách nhóm theo kỳ thi (sub-tabs)

**Tab 2 - TRA CỨU HỌC SINH:**
- 2.1 Lọc học sinh theo nhóm Zalo (Exam, Mã lớp, Trạng thái)
- 2.2 Học sinh chưa vào nhóm

## Tech

- HTML self-contained (Chart.js qua CDN)
- Vercel Serverless Functions
- Google Apps Script (auth proxy)

## Tác giả

HOCMAI · thuypt2
