#!/usr/bin/env python
"""Reset password for GVCN accounts."""
import urllib.request
import json

BASE = "https://hocmai-report-zalo.vercel.app/api/auth"

# Step 1: Admin login
login_url = f"{BASE}?action=login&username=admin&password=@Hocmai2026Admin"
req = urllib.request.Request(login_url)
with urllib.request.urlopen(req) as resp:
    login_data = json.loads(resp.read().decode())
    
if not login_data.get("ok"):
    print(f"Admin login failed: {login_data}")
    exit(1)

token = login_data["token"]
print(f"Admin logged in, token length: {len(token)}")

# Step 2: Update GVCN accounts
accounts = [
    {"username": "cuongha", "name": "Hà Anh Cương", "email": "cuongha@hocmai.vn", "role": "gvcn"},
    {"username": "gvcn.huyentt5", "name": "Trần Thu Huyền", "email": "huyentt5@hocmai.vn", "role": "gvcn"},
    {"username": "gvcn.duonght", "name": "Hoàng Thùy Dương", "email": "duonght2@hocmai.vn", "role": "gvcn"},
]

for acc in accounts:
    body = json.dumps({
        "action": "update",
        "token": token,
        "username": acc["username"],
        "password": "123456",
        "role": acc["role"],
        "name": acc["name"],
        "email": acc["email"],
        "active": True
    }).encode()
    
    req = urllib.request.Request(BASE, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
    
    status = "OK" if result.get("ok") else f"FAIL: {result.get('error')}"
    print(f"  {acc['username']}: {status}")

# Step 3: Verify
print("\n=== Verification ===")
for acc in accounts:
    verify_url = f"{BASE}?action=login&username={acc['username']}&password=123456"
    req = urllib.request.Request(verify_url)
    with urllib.request.urlopen(req) as resp:
        verify = json.loads(resp.read().decode())
    status = "OK" if verify.get("ok") else f"FAIL: {verify.get('error')}"
    print(f"  {acc['username']}: {status}")