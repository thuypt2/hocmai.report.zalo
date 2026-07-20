# hocmai.report.zalo

Báo cáo Zalo - HOCMAI

Trang báo cáo live deploy trên Vercel. Frontend load dữ liệu qua các API route
trong `api/`. Dữ liệu báo cáo chính được lấy qua TopUni2 data API.

## Cấu trúc

```
.
├── index.html                        # Redirect vào BaoCaoZalo_v1.html
├── BaoCaoZalo_v1.html                # Frontend báo cáo chính (self-contained)
├── admin.html                        # Quản trị tài khoản phân quyền
├── api/
│   ├── auth.js                       # Login/JWT/quản trị tài khoản
│   ├── get-data.js                   # Gọi TopUni2 data API và tính KPI
│   ├── get-wait-members.js           # Lấy học sinh chờ duyệt Zalo
│   ├── send-class-group-email.js     # Proxy gửi email
│   └── accept-members.js             # Proxy duyệt thành viên qua Flow 7
├── vercel.json                       # Cấu hình Vercel
└── README.md
```

## Báo cáo gồm 2 tab

**Tab 1 - TỔNG QUAN:**
- 1.1 Thống kê học sinh duyệt nhóm 1:30 & AIM theo kỳ thi (KPI cards + bảng)
- 1.2 Pie chart (tổng HS theo kỳ thi + HSA Tiếng Anh vs Khoa học)
- 1.3 Thống kê số lượng HS được duyệt theo từng nhóm lớp 1:30
- 1.4 Biểu đồ theo tháng trả tiền (paid_time) theo từng exam

**Tab 2 - TRA CỨU HỌC SINH THEO NHÓM LỚP:**
- 2.1 Lọc học sinh theo nhóm lớp (Exam, Mã lớp, Trạng thái, Date range)
- 2.2 Lọc học sinh chưa vào nhóm 1:30 + Gửi email hàng loạt
- 2.3 Học sinh chờ duyệt kết nối (Wait_member + Duyệt Flow 7)

## Auth

- **Admin:** admin / @Hocmai2026Admin
- **GVCN:** chỉ xem nhóm lớp được phân công
- **DVKH:** chỉ tra cứu nhanh, không xem overview

## Tech

- HTML self-contained (Chart.js qua CDN)
- Vercel Serverless Functions
- Google Apps Script (auth proxy)
- Flow 7 accept-members API

## Tác giả

HOCMAI · thuypt2
