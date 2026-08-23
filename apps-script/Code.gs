/**
 * SCAD Evidence & Gap Assessment Dashboard
 * Lightweight shared data service for a Google Sheets-bound Apps Script.
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 */

const TABLES = ['requests', 'gaps', 'evidenceRegister', 'existingEvidence'];

function doGet() {
  try {
    return jsonResponse({ ok: true, data: readDatabase() });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

function doPost(event) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    if (payload.action !== 'replaceAll' || !payload.data) {
      throw new Error('Unsupported request. Expected action "replaceAll".');
    }
    writeDatabase(payload.data);
    return jsonResponse({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  } finally {
    lock.releaseLock();
  }
}

function readDatabase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const data = {};
  TABLES.forEach(function (tableName) {
    const sheet = spreadsheet.getSheetByName(tableName);
    if (!sheet || sheet.getLastRow() < 2) {
      data[tableName] = [];
      return;
    }
    data[tableName] = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues()
      .flat()
      .filter(String)
      .map(function (recordJson) { return JSON.parse(recordJson); });
  });
  return data;
}

function writeDatabase(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  TABLES.forEach(function (tableName) {
    let sheet = spreadsheet.getSheetByName(tableName);
    if (!sheet) sheet = spreadsheet.insertSheet(tableName);
    sheet.clearContents();
    sheet.getRange('A1').setValue('record_json').setFontWeight('bold');
    const records = Array.isArray(data[tableName]) ? data[tableName] : [];
    if (records.length) {
      const rows = records.map(function (record) { return [JSON.stringify(record)]; });
      sheet.getRange(2, 1, rows.length, 1).setValues(rows);
    }
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 500);
  });
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
