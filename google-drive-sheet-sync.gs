/**
 * Google Drive -> Google Sheet sync for the course review dashboard.
 *
 * How it matches files:
 * 1. Best option: add a "Drive Folder ID" column to the sheet. Each row can point
 *    to the Drive folder for that course. The latest file in that folder is used.
 * 2. Fallback: put one or more parent folder IDs in ROOT_FOLDER_IDS below. The
 *    script searches those folders recursively and matches files whose names
 *    contain the course code from the "รหัสวิชา" column.
 *
 * Recommended file naming when using ROOT_FOLDER_IDS:
 *   412301_มคอ3_ชื่อรายวิชา.pdf
 *   412301-มคอ4-ชื่อรายวิชา.docx
 */

const DRIVE_SYNC_CONFIG = {
  SHEET_NAME: '', // Leave blank to use the active sheet.
  HEADER_ROW: 1,

  // Optional fallback parent folders. Paste folder IDs here if you do not add
  // a Drive Folder ID per course row.
  ROOT_FOLDER_IDS: [
    // 'PASTE_MAIN_DRIVE_FOLDER_ID_HERE'
  ],

  // If true, files found by the script are changed to "anyone with the link can view".
  // Keep false if your school controls sharing through Google groups or domains.
  MAKE_FILES_VIEWABLE_BY_LINK: false,

  COURSE_CODE_HEADERS: ['รหัสวิชา', 'รหัส', 'Course Code', 'course_code'],
  FILE_LINK_HEADERS: ['ลิงก์ไฟล์', 'Link', 'ลิงค์ไฟล์ มคอ.'],
  UPLOAD_HEADERS: ['อัพไฟล์', 'อัปโหลดไฟล์', 'Uploaded'],
  FOLDER_ID_HEADERS: ['Drive Folder ID', 'Folder ID', 'รหัสโฟลเดอร์ Drive', 'โฟลเดอร์ไฟล์'],
  FILE_ID_HEADERS: ['Google Drive File ID', 'File ID'],
  FILE_NAME_HEADERS: ['ชื่อไฟล์ล่าสุด', 'File Name'],
  FOUND_AT_HEADERS: ['วันที่พบไฟล์', 'Found At']
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Drive Sync')
    .addItem('สแกนไฟล์และเติมลิงก์', 'syncDriveLinksToSheet')
    .addItem('สร้าง Trigger ทุก 5 นาที', 'createDriveSyncTrigger')
    .addToUi();
}

function syncDriveLinksToSheet() {
  const sheet = getTargetSheet_();
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();

  if (lastRow <= headerRow) {
    notify_('ไม่พบข้อมูลรายวิชาในชีต');
    return;
  }

  const columns = getOrCreateColumns_(sheet);
  const lastColumn = sheet.getLastColumn();
  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  const rootFilesByCourseCode = buildRootFileIndex_();

  let updatedCount = 0;
  const now = new Date();

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const courseCode = normalizeCourseCode_(row[columns.courseCode - 1]);
    if (!courseCode) return;

    const existingFileId = row[columns.fileId - 1];
    const folderId = columns.folderId ? extractDriveId_(row[columns.folderId - 1]) : '';
    const file = folderId
      ? findLatestFileInFolder_(folderId)
      : rootFilesByCourseCode[courseCode];

    if (!file) return;
    if (existingFileId && existingFileId === file.id) return;

    if (DRIVE_SYNC_CONFIG.MAKE_FILES_VIEWABLE_BY_LINK) {
      makeFileViewableByLink_(file.id);
    }

    sheet.getRange(rowNumber, columns.fileLink).setValue(file.url);
    sheet.getRange(rowNumber, columns.upload).setValue(true);
    sheet.getRange(rowNumber, columns.fileId).setValue(file.id);
    sheet.getRange(rowNumber, columns.fileName).setValue(file.name);
    sheet.getRange(rowNumber, columns.foundAt).setValue(now);
    updatedCount += 1;
  });

  notify_(`อัปเดตลิงก์ไฟล์แล้ว ${updatedCount} รายวิชา`);
}

function createDriveSyncTrigger() {
  const handler = 'syncDriveLinksToSheet';
  const alreadyExists = ScriptApp.getProjectTriggers()
    .some(trigger => trigger.getHandlerFunction() === handler);

  if (!alreadyExists) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyMinutes(5)
      .create();
  }

  notify_('ตั้งค่าให้สแกนไฟล์อัตโนมัติทุก 5 นาทีแล้ว');
}

function getTargetSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (DRIVE_SYNC_CONFIG.SHEET_NAME) {
    const sheet = spreadsheet.getSheetByName(DRIVE_SYNC_CONFIG.SHEET_NAME);
    if (!sheet) throw new Error(`Sheet not found: ${DRIVE_SYNC_CONFIG.SHEET_NAME}`);
    return sheet;
  }
  return spreadsheet.getActiveSheet();
}

function getOrCreateColumns_(sheet) {
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];

  const courseCode = findColumn_(headers, DRIVE_SYNC_CONFIG.COURSE_CODE_HEADERS);
  if (!courseCode) {
    throw new Error(`Missing course code column. Expected one of: ${DRIVE_SYNC_CONFIG.COURSE_CODE_HEADERS.join(', ')}`);
  }

  return {
    courseCode,
    folderId: findColumn_(headers, DRIVE_SYNC_CONFIG.FOLDER_ID_HEADERS),
    fileLink: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FILE_LINK_HEADERS[0]),
    upload: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.UPLOAD_HEADERS[0]),
    fileId: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FILE_ID_HEADERS[0]),
    fileName: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FILE_NAME_HEADERS[0]),
    foundAt: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FOUND_AT_HEADERS[0])
  };
}

function findColumn_(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeader_);
  for (let index = 0; index < headers.length; index += 1) {
    if (normalizedCandidates.includes(normalizeHeader_(headers[index]))) {
      return index + 1;
    }
  }
  return 0;
}

function findOrCreateColumn_(sheet, headers, headerName) {
  const existingColumn = findColumn_(headers, [headerName]);
  if (existingColumn) return existingColumn;

  const column = sheet.getLastColumn() + 1;
  sheet.getRange(DRIVE_SYNC_CONFIG.HEADER_ROW, column).setValue(headerName);
  headers.push(headerName);
  return column;
}

function buildRootFileIndex_() {
  const index = {};
  DRIVE_SYNC_CONFIG.ROOT_FOLDER_IDS
    .map(extractDriveId_)
    .filter(Boolean)
    .forEach(folderId => {
      const folder = DriveApp.getFolderById(folderId);
      collectFilesByCourseCode_(folder, index);
    });
  return index;
}

function collectFilesByCourseCode_(folder, index) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const courseCode = extractCourseCodeFromFileName_(file.getName());
    if (!courseCode) continue;

    const current = index[courseCode];
    if (!current || file.getLastUpdated() > current.updatedAt) {
      index[courseCode] = fileToRecord_(file);
    }
  }

  const folders = folder.getFolders();
  while (folders.hasNext()) {
    collectFilesByCourseCode_(folders.next(), index);
  }
}

function findLatestFileInFolder_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  let latest = null;

  while (files.hasNext()) {
    const file = files.next();
    if (!latest || file.getLastUpdated() > latest.updatedAt) {
      latest = fileToRecord_(file);
    }
  }

  return latest;
}

function fileToRecord_(file) {
  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    updatedAt: file.getLastUpdated()
  };
}

function makeFileViewableByLink_(fileId) {
  DriveApp.getFileById(fileId)
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

function extractCourseCodeFromFileName_(fileName) {
  const match = String(fileName || '').match(/[A-Za-z]{0,4}\d{4,8}[A-Za-z]{0,2}/);
  return match ? normalizeCourseCode_(match[0]) : '';
}

function normalizeCourseCode_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_/]/g, '');
}

function normalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function extractDriveId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const folderMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const fileMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  return text;
}

function notify_(message) {
  Logger.log(message);
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Drive Sync', 5);
  } catch (error) {
    Logger.log(error);
  }
}
