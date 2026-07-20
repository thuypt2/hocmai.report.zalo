/**
 * api/auth.js — Xác thực & quản trị tài khoản phân quyền
 *
 * Backend: Google Sheets (sheet "Accounts") qua Apps Script GET params.
 * KHÔNG dùng POST (Google redirect POST về trang HTML).
 * KHÔNG dùng fs (Vercel serverless read-only).
 *
 * Roles: admin | gvcn | dvkh
 * Login → JWT HS256
 */

const crypto = require('crypto');
const https  = require('https');

const APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwtPmnT_Q_WSzgH9VrH3LwW3PrIL9-p35VVTuADjcHnmHIadv6g4E2miRqQKs002_x2Nw/exec';

const SECRET = process.env.ACCOUNTS_SECRET || '@HocmaiAdmin2026';

// ── JWT helpers ──────────────────────────────────────────────────────────────
function b64u(buf) {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function b64uDec(s) {
  let t = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  while (t.length%4) t+='=';
  return Buffer.from(t,'base64').toString('utf8');
}
function createToken(payload) {
  const h = b64u(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest('base64')
              .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${h}.${p}.${s}`;
}
function verifyToken(token) {
  if (!token||typeof token!=='string') return {ok:false,error:'Thiếu token'};
  const parts = token.split('.');
  if (parts.length!==3) return {ok:false,error:'Token không hợp lệ'};
  const [h,p,s] = parts;
  const exp = b64u(crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest());
  try {
    const aB = Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
    const bB = Buffer.from(exp.replace(/-/g,'+').replace(/_/g,'/'),'base64');
    if (aB.length!==bB.length || !crypto.timingSafeEqual(aB,bB))
      return {ok:false,error:'Token sai chữ ký'};
    const payload = JSON.parse(b64uDec(p));
    if (!payload||!payload.sub||!payload.role) return {ok:false,error:'Token thiếu dữ liệu'};
    if (payload.exp && Math.floor(Date.now()/1000)>payload.exp) return {ok:false,error:'Token đã hết hạn'};
    return {ok:true,payload};
  } catch(e) { return {ok:false,error:'Token lỗi: '+e.message}; }
}

// ── SHA256 Node (verify phải khớp GAS sha256Gs) ─────────────────────────────
function sha256hex(v) {
  return crypto.createHash('sha256').update(String(v||''),'utf8').digest('hex');
}

// ── HTTP GET follow redirect ─────────────────────────────────────────────────
function fetchGET(url, depth) {
  depth = depth||0;
  if (depth>5) return Promise.reject(new Error('Quá nhiều redirect'));
  return new Promise((resolve,reject)=>{
    let buf='';
    const req = https.get(url, {headers:{'User-Agent':'Vercel/1.0','Accept':'application/json'}}, res=>{
      if (res.statusCode>=300&&res.statusCode<400&&res.headers.location) {
        return fetchGET(res.headers.location, depth+1).then(resolve).catch(reject);
      }
      res.on('data',d=>{buf+=d});
      res.on('end',()=>{
        try { resolve(JSON.parse(buf)); }
        catch(e) { reject(new Error('Không parse JSON: '+buf.slice(0,200))); }
      });
    });
    req.setTimeout(20000,()=>{ req.destroy(); reject(new Error('Apps Script timeout')); });
    req.on('error',reject);
  });
}

// ── Gọi Apps Script qua GET params ──────────────────────────────────────────
function gasGet(params) {
  const qs = Object.entries(params)
    .map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v==null?'':v))}`)
    .join('&');
  return fetchGET(`${APPS_SCRIPT_URL}?${qs}`);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  res.setHeader('Cache-Control','no-store');
}

// ── Lấy token từ request ─────────────────────────────────────────────────────
function extractToken(req, body) {
  const auth = (req.headers||{}).authorization||'';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (body&&body.token)||(m?m[1]:'')
      || ((req.query||{}).token)||'';
}

// ── Parse body ───────────────────────────────────────────────────────────────
async function parseBody(req) {
  if (req.body && typeof req.body==='object') return req.body;
  return new Promise((resolve,reject)=>{
    let buf='';
    req.on('data',c=>{buf+=c});
    req.on('end',()=>{ try{resolve(buf?JSON.parse(buf):{});}catch(e){reject(new Error('Body JSON lỗi'));} });
    req.on('error',reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// LOGIN — gọi Apps Script verifyLogin
async function handleLogin(req, res) {
  const username = String((req.query||{}).username||'').trim();
  const password = String((req.query||{}).password||'');
  if (!username||!password)
    return res.status(400).json({ok:false,error:'Thiếu username hoặc password'});

  // Thử verifyLogin (cần Apps Script đã paste code mới)
  // Nếu Apps Script chưa có action verifyLogin (trả total≠undefined) thì fallback tự verify
  let result;
  try {
    result = await gasGet({action:'verifyLogin', secret:SECRET, username, password});
  } catch(e) {
    return res.status(503).json({ok:false,error:'Lỗi kết nối Apps Script: '+e.message});
  }

  // Nếu Apps Script cũ (chưa có verifyLogin) → trả total = số rows, không có .role
  // Fallback: lấy accounts kèm hash rồi tự compare
  if (result.total !== undefined || (!result.ok && !result.error)) {
    // Apps Script chưa có action verifyLogin → tự verify qua getAccounts+includeHash
    let accsResult;
    try {
      accsResult = await gasGet({action:'getAccounts', secret:SECRET, includeHash:'1'});
    } catch(e) {
      return res.status(503).json({ok:false,error:'Lỗi kết nối Apps Script: '+e.message});
    }
    if (!accsResult.ok)
      return res.status(503).json({ok:false,error:accsResult.error||'Không đọc được accounts'});

    const accounts = Array.isArray(accsResult.accounts) ? accsResult.accounts : [];
    const acc = accounts.find(a=>a.username===username);
    if (!acc) return res.status(401).json({ok:false,error:'Tài khoản không tồn tại'});
    if (!acc.active) return res.status(401).json({ok:false,error:'Tài khoản đã bị khóa'});
    if (!acc.password_hash)
      return res.status(503).json({ok:false,error:'Chưa có thông tin hash — paste code Apps Script mới và redeploy'});
    if (acc.password_hash !== sha256hex(password))
      return res.status(401).json({ok:false,error:'Sai mật khẩu'});

    result = {ok:true, role:acc.role, name:acc.name||''};
  }

  if (!result.ok)
    return res.status(401).json({ok:false,error:result.error||'Xác thực thất bại'});

  const nowSec = Math.floor(Date.now()/1000);
  const token  = createToken({sub:username, role:result.role, name:result.name||'', iat:nowSec, exp:nowSec+7*24*3600});
  return res.status(200).json({ok:true, role:result.role, name:result.name||'', token});
}

// LIST
async function handleList(req, body, res) {
  const token    = extractToken(req, body);
  const verified = verifyToken(token);
  if (!verified.ok) return res.status(403).json(verified);
  if (verified.payload.role!=='admin')
    return res.status(403).json({ok:false,error:'Chỉ admin mới được xem danh sách'});

  let r;
  try { r = await gasGet({action:'getAccounts', secret:SECRET}); }
  catch(e) { return res.status(503).json({ok:false,error:e.message}); }
  if (!r.ok) return res.status(400).json(r);
  return res.status(200).json(r);
}

// CREATE — dùng GET params (POST bị Google chặn redirect)
async function handleCreate(req, body, res) {
  const token    = extractToken(req, body);
  const verified = verifyToken(token);
  if (!verified.ok) return res.status(403).json(verified);
  if (verified.payload.role!=='admin')
    return res.status(403).json({ok:false,error:'Chỉ admin mới được tạo tài khoản'});

  // Tạo account trực tiếp trong Node — không POST qua Apps Script
  // Lý do: POST bị Google redirect về trang HTML (Content-Length issue)
  // Giải pháp: Dùng getAccounts?includeHash=1 → thêm record → writeAccounts qua Apps Script
  // Nhưng Apps Script không có action writeAccounts... → dùng action createAccount qua GET
  let r;
  try {
    r = await gasGet({
      action:'createAccount', secret:SECRET,
      username:body.username||'', password:body.password||'',
      role:body.role||'dvkh', name:body.name||'',
      email:body.email||'', active:body.active===false?'false':'true',
    });
  } catch(e) { return res.status(503).json({ok:false,error:e.message}); }
  if (!r.ok) return res.status(400).json(r);
  return res.status(200).json(r);
}

// UPDATE
async function handleUpdate(req, body, res) {
  const token    = extractToken(req, body);
  const verified = verifyToken(token);
  if (!verified.ok) return res.status(403).json(verified);
  if (verified.payload.role!=='admin')
    return res.status(403).json({ok:false,error:'Chỉ admin mới được cập nhật tài khoản'});

  let r;
  try {
    r = await gasGet({
      action:'updateAccount', secret:SECRET,
      username:body.username||'', password:body.password||'',
      role:body.role||'', name:body.name||'',
      email:body.email||'', active:body.active===false?'false':'true',
    });
  } catch(e) { return res.status(503).json({ok:false,error:e.message}); }
  if (!r.ok) return res.status(400).json(r);
  return res.status(200).json(r);
}

// DELETE
async function handleDelete(req, body, res) {
  const token    = extractToken(req, body);
  const verified = verifyToken(token);
  if (!verified.ok) return res.status(403).json(verified);
  if (verified.payload.role!=='admin')
    return res.status(403).json({ok:false,error:'Chỉ admin mới được xóa tài khoản'});

  let r;
  try {
    r = await gasGet({action:'deleteAccount', secret:SECRET, username:body.username||''});
  } catch(e) { return res.status(503).json({ok:false,error:e.message}); }
  if (!r.ok) return res.status(400).json(r);
  return res.status(200).json(r);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method==='OPTIONS') return res.status(204).end();

  try {
    if (req.method==='GET') {
      const action = String((req.query||{}).action||'').trim();
      if (action==='login') return await handleLogin(req, res);
      if (action==='list')  {
        const body = await parseBody(req);
        return await handleList(req, body, res);
      }
      return res.status(400).json({ok:false,error:'GET action không hợp lệ'});
    }

    if (req.method==='POST') {
      const body   = await parseBody(req);
      const action = String(body.action||'').trim();
      if (action==='create') return await handleCreate(req, body, res);
      if (action==='update') return await handleUpdate(req, body, res);
      if (action==='delete') return await handleDelete(req, body, res);
      return res.status(400).json({ok:false,error:'POST action không hợp lệ'});
    }

    return res.status(405).json({ok:false,error:'Method not allowed'});
  } catch(e) {
    console.error('auth error:', e);
    return res.status(500).json({ok:false,error:e.message||'Internal error'});
  }
};
