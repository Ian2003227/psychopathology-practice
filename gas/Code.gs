/**
 * Account + cloud sync backend for the psychopathology practice site.
 *
 * Sheets (created automatically on first use):
 *   settings  — key/value pairs. Fill in access_code (the 通關密語 that unlocks data/bank.enc).
 *   users     — one row per registered nickname (salted password hash + login token).
 *   progress  — one row per (user, item) so each person's progress follows them across devices.
 *
 * Deploy: in a Google Sheet → Extensions → Apps Script → paste this file → Deploy →
 * New deployment → Web app (Execute as: Me, Who has access: Anyone). Put the /exec URL in js/config.js.
 * Then open the "settings" sheet (run the site once, or run setup() in the editor) and set access_code.
 *
 * The access code lives only in the sheet, never in this file: the repo is public.
 */

var USER_HEADERS = ["nickname", "salt", "hash", "token", "created_at", "last_login", "fails", "locked_until"];
var PROGRESS_HEADERS = ["user", "item_id", "at", "record_json"];
var HASH_ROUNDS = 1000;
var MAX_FAILS = 5;
var LOCK_MS = 5 * 60 * 1000;

function sheetOf_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function settingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("settings");
  if (!sh) {
    sh = ss.insertSheet("settings");
    sh.getRange(1, 1, 3, 3).setValues([
      ["key", "value", "說明"],
      ["access_code", "", "通關密語：學弟妹註冊時要輸入，也是題庫 data/bank.enc 的加密密語"],
      ["registration_open", "TRUE", "填 FALSE 可暫停新註冊（已註冊的人仍可登入）"],
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function setting_(key) {
  var values = settingsSheet_().getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return String(values[i][1]).trim();
  }
  return "";
}

/** Run once from the Apps Script editor to create all sheets. */
function setup() {
  settingsSheet_();
  sheetOf_("users", USER_HEADERS);
  sheetOf_("progress", PROGRESS_HEADERS);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hex_(bytes) {
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function hashPassword_(salt, password) {
  var h = salt + ":" + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function newSecret_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function normNick_(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

// Returns { row (1-based), data } for a nickname, case-insensitive.
function findUser_(sh, nickname) {
  var key = nickname.toLowerCase();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === key) return { row: i + 1, data: values[i] };
  }
  return null;
}

// Returns the stored (canonical) nickname when the token is valid, otherwise null.
function authUser_(user, token) {
  if (!user || !token) return null;
  var hit = findUser_(sheetOf_("users", USER_HEADERS), user);
  return hit && String(hit.data[3]) === token ? String(hit.data[0]) : null;
}

function register_(p) {
  var nickname = normNick_(p.nickname);
  var password = String(p.password || "");
  var code = setting_("access_code");
  if (!code) return { ok: false, error: "管理員尚未在 settings 工作表設定通關密語" };
  if (setting_("registration_open").toUpperCase() === "FALSE") return { ok: false, error: "目前暫停註冊" };
  if (String(p.accessCode || "").trim() !== code) return { ok: false, error: "通關密語錯誤" };
  if (nickname.length < 1 || nickname.length > 20) return { ok: false, error: "暱稱長度須為 1–20 字" };
  if (nickname.indexOf("__") === 0) return { ok: false, error: "暱稱不能以 __ 開頭" };
  if (password.length < 4) return { ok: false, error: "密碼至少 4 個字元" };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheetOf_("users", USER_HEADERS);
    if (findUser_(sh, nickname)) return { ok: false, error: "這個暱稱已經有人用了，換一個吧" };
    var salt = newSecret_();
    var token = newSecret_();
    var now = new Date();
    // Prefix with ' so Sheets never reinterprets a nickname like "2272" or "=1+1".
    sh.appendRow(["'" + nickname, salt, hashPassword_(salt, password), token, now, now, 0, 0]);
    return { ok: true, user: nickname, token: token, accessCode: code };
  } finally {
    lock.releaseLock();
  }
}

function login_(p) {
  var nickname = normNick_(p.nickname);
  var password = String(p.password || "");
  var sh = sheetOf_("users", USER_HEADERS);
  var hit = findUser_(sh, nickname);
  if (!hit) return { ok: false, error: "暱稱或密碼錯誤" };
  var now = Date.now();
  var lockedUntil = Number(hit.data[7]) || 0;
  if (lockedUntil > now) return { ok: false, error: "嘗試太多次，請 " + Math.ceil((lockedUntil - now) / 60000) + " 分鐘後再試" };
  if (hashPassword_(String(hit.data[1]), password) !== String(hit.data[2])) {
    var fails = (Number(hit.data[6]) || 0) + 1;
    sh.getRange(hit.row, 7, 1, 2).setValues([[fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : 0]]);
    return { ok: false, error: "暱稱或密碼錯誤" };
  }
  var code = setting_("access_code");
  if (!code) return { ok: false, error: "管理員尚未在 settings 工作表設定通關密語" };
  // The token is shared by all of a user's devices, so logging in on a phone keeps the laptop signed in.
  var token = String(hit.data[3]) || newSecret_();
  sh.getRange(hit.row, 4).setValue(token);
  sh.getRange(hit.row, 6, 1, 3).setValues([[new Date(), 0, 0]]);
  return { ok: true, user: String(hit.data[0]), token: token, accessCode: code };
}

function changePassword_(p) {
  var sh = sheetOf_("users", USER_HEADERS);
  var hit = findUser_(sh, normNick_(p.user));
  if (!hit || String(hit.data[3]) !== String(p.token || "")) return { ok: false, error: "auth" };
  if (hashPassword_(String(hit.data[1]), String(p.oldPassword || "")) !== String(hit.data[2])) return { ok: false, error: "目前的密碼不正確" };
  var password = String(p.newPassword || "");
  if (password.length < 4) return { ok: false, error: "密碼至少 4 個字元" };
  var salt = newSecret_();
  var token = newSecret_(); // signs out every other device
  sh.getRange(hit.row, 2, 1, 3).setValues([[salt, hashPassword_(salt, password), token]]);
  return { ok: true, token: token };
}

function getProgress_(user) {
  var values = sheetOf_("progress", PROGRESS_HEADERS).getDataRange().getValues();
  var records = {};
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== user) continue;
    try {
      records[values[i][1]] = { at: Number(values[i][2]) || 0, record: JSON.parse(values[i][3]) };
    } catch (err) { /* skip a malformed row */ }
  }
  return { ok: true, records: records };
}

function putProgress_(user, items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheetOf_("progress", PROGRESS_HEADERS);
    var data = sh.getDataRange().getValues();
    var rowOf = {};
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]) === user) rowOf[data[r][1]] = { row: r + 1, at: Number(data[r][2]) || 0 };
    }
    var appended = [];
    (items || []).forEach(function (it) {
      var line = ["'" + user, it.item_id, Number(it.at) || Date.now(), JSON.stringify(it.record)];
      var hit = rowOf[it.item_id];
      if (hit) {
        if (line[2] >= hit.at) sh.getRange(hit.row, 1, 1, 4).setValues([line]);
      } else {
        appended.push(line);
        rowOf[it.item_id] = { row: -1, at: line[2] };
      }
    });
    if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, 4).setValues(appended);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var p = body.payload || {};

  if (body.action === "register") return json_(register_(p));
  if (body.action === "login") return json_(login_(p));
  if (body.action === "changePassword") return json_(changePassword_(p));

  var user = authUser_(normNick_(p.user), String(p.token || ""));
  if (!user) return json_({ ok: false, error: "auth" });
  if (body.action === "get") return json_(getProgress_(user));
  if (body.action === "put") return json_(putProgress_(user, p.items));

  return json_({ ok: false, error: "unknown action" });
}

function doGet() {
  return json_({ ok: true, message: "Psychopathology practice backend is running." });
}
