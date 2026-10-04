/**
 * Cloud sync backend for the psychopathology practice site.
 * Stores one row per (user, item) so each person's progress follows them across devices.
 * Deploy: in a NEW Google Sheet → Extensions → Apps Script → paste this file → Deploy →
 * New deployment → Web app (Execute as: Me, Who has access: Anyone). Put the /exec URL in js/config.js.
 */

var HEADERS = ["user", "item_id", "at", "record_json"];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("progress");
  if (!sh) {
    sh = ss.insertSheet("progress");
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var p = body.payload || {};
  var user = String(p.user || "");
  if (!user) return json_({ ok: false, error: "missing user" });

  if (body.action === "get") {
    var values = sheet_().getDataRange().getValues();
    var records = {};
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) !== user) continue;
      try {
        records[values[i][1]] = { at: Number(values[i][2]) || 0, record: JSON.parse(values[i][3]) };
      } catch (err) { /* skip a malformed row */ }
    }
    return json_({ ok: true, records: records });
  }

  if (body.action === "put") {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = sheet_();
      var data = sh.getDataRange().getValues();
      var rowOf = {};
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0]) === user) rowOf[data[r][1]] = { row: r + 1, at: Number(data[r][2]) || 0 };
      }
      var appended = [];
      (p.items || []).forEach(function (it) {
        var line = [user, it.item_id, Number(it.at) || Date.now(), JSON.stringify(it.record)];
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
    return json_({ ok: true });
  }

  return json_({ ok: false, error: "unknown action" });
}

function doGet() {
  return json_({ ok: true, message: "Psychopathology practice sync backend is running." });
}
