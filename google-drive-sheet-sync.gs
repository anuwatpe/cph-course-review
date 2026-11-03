/**
 * Google Drive -> Google Sheet sync for the course review dashboard.
 *
 * How it matches files:
 * 1. Easiest option: run "สร้างโฟลเดอร์รายวิชา" from the Drive Sync menu.
 *    The script creates folders by term, then one folder per course row, and
 *    writes its Drive Folder ID back to the sheet. The latest file in that
 *    course folder is used.
 * 2. Fallback: put one or more parent folder IDs in ROOT_FOLDER_IDS below. The
 *    script searches those folders recursively and matches files whose names
 *    contain the course code from the "รหัสวิชา" column.
 *
 * Recommended file naming when using ROOT_FOLDER_IDS:
 *   412301_มคอ3_ชื่อรายวิชา.pdf
 *   412301-มคอ4-ชื่อรายวิชา.docx
 */

const DRIVE_SYNC_CONFIG = {
  SHEET_NAME: '', // Optional override for a different named tab.
  SHEET_ID: 486231050, // Summary tab used by APCRIS; this is the gid in the tab URL.
  HEADER_ROW: 1,

  // Leave COURSE_ROOT_FOLDER_ID blank to let the script create one parent folder
  // automatically in My Drive. The created folder ID is saved in script properties.
  COURSE_ROOT_FOLDER_ID: '1UbOEAgTVa20w8-LJAOD1pFL9HtZjxpaf',
  COURSE_ROOT_FOLDER_NAME: 'Course Review Uploads',
  AUTO_CREATE_COURSE_FOLDERS: true,
  GROUP_COURSE_FOLDERS_BY_TERM: true,

  // Optional fallback parent folders. Paste folder IDs here if you do not add
  // a Drive Folder ID per course row.
  ROOT_FOLDER_IDS: [
    // 'PASTE_MAIN_DRIVE_FOLDER_ID_HERE'
  ],

  // If true, files found by the script are changed to "anyone with the link can view".
  // Set false if your school controls sharing through Google groups or domains.
  MAKE_FILES_VIEWABLE_BY_LINK: true,
  MAKE_FOLDERS_VIEWABLE_BY_LINK: false,
  AUTO_SHARE_COURSE_FOLDERS_WITH_INSTRUCTORS: false,

  COURSE_CODE_HEADERS: ['รหัสวิชา', 'รหัส', 'Course Code', 'course_code'],
  COURSE_NAME_HEADERS: ['ชื่อรายวิชา', 'รายวิชา', 'Course Name', 'course_name'],
  INSTRUCTOR_EMAIL_HEADERS: ['อีเมล', 'อีเมลผู้รับผิดชอบ', 'อีเมลอาจารย์', 'Instructor Email', 'teacher_email'],
  TERM_HEADERS: ['ภาคการศึกษา', 'เทอม', 'Term'],
  ACADEMIC_YEAR_HEADERS: ['ปีการศึกษา', 'Academic Year', 'year'],
  FILE_LINK_HEADERS: ['ลิงก์ไฟล์', 'Link', 'ลิงค์ไฟล์ มคอ.'],
  UPLOAD_HEADERS: ['อัพไฟล์', 'อัปโหลดไฟล์', 'Uploaded'],
  FOLDER_ID_HEADERS: ['Drive Folder ID', 'Folder ID', 'รหัสโฟลเดอร์ Drive', 'โฟลเดอร์ไฟล์'],
  FOLDER_LINK_HEADERS: ['ลิงก์โฟลเดอร์อัปโหลด', 'Drive Folder Link', 'Folder Link'],
  TERM_FOLDER_LINK_HEADERS: ['ลิงก์โฟลเดอร์เทอม', 'Term Folder Link'],
  FOLDER_SHARED_WITH_HEADERS: ['แชร์โฟลเดอร์ให้', 'Folder Shared With'],
  FILE_ID_HEADERS: ['Google Drive File ID', 'File ID'],
  FILE_NAME_HEADERS: ['ชื่อไฟล์ล่าสุด', 'File Name'],
  FOUND_AT_HEADERS: ['วันที่พบไฟล์', 'Found At']
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Drive Sync')
    .addItem('สร้างโฟลเดอร์รายวิชา', 'createCourseFoldersFromSheet')
    .addItem('จัดโฟลเดอร์เดิมเข้าเทอม', 'organizeExistingCourseFoldersByTerm')
    .addItem('แชร์โฟลเดอร์ให้อาจารย์', 'shareCourseFoldersWithInstructors')
    .addItem('สแกนไฟล์และเติมลิงก์', 'syncDriveLinksToSheet')
    .addItem('สแกนและเติมลิงก์ (คงสิทธิ์ไฟล์)', 'scanDriveLinksWithoutSharing')
    .addItem('ตรวจการเข้าถึง Drive', 'checkDriveSyncAccess')
    .addItem('ตั้งสิทธิ์ไฟล์ให้เปิดผ่านลิงก์', 'makeLinkedFilesViewableByLink')
    .addItem('สร้างโฟลเดอร์และสแกนไฟล์', 'createFoldersAndSyncDriveLinks')
    .addItem('สร้าง Trigger ทุก 5 นาที', 'createDriveSyncTrigger')
    .addItem('ปิด Trigger อัตโนมัติ', 'deleteDriveSyncTriggers')
    .addToUi();
  if (typeof apcrisReminderMenu_ === 'function') apcrisReminderMenu_();
}

function createFoldersAndSyncDriveLinks() {
  createCourseFoldersFromSheet();
  syncDriveLinksToSheet();
}

function createCourseFoldersFromSheet() {
  const result = ensureCourseFolders_(true);
  notify_(`สร้าง/ตรวจโฟลเดอร์แล้ว ${result.createdCount} ใหม่, ${result.existingCount} มีอยู่แล้ว`);
}

function organizeExistingCourseFoldersByTerm() {
  const result = moveExistingCourseFoldersToTermFolders_();
  notify_(`จัดโฟลเดอร์เข้าเทอมแล้ว ${result.movedCount} รายวิชา, ข้าม ${result.skippedCount} รายวิชา`);
}

function makeLinkedFilesViewableByLink() {
  const result = makeSheetLinkedFilesViewable_();
  notify_(`ตั้งสิทธิ์ไฟล์แล้ว ${result.updatedCount} ไฟล์, ข้าม ${result.skippedCount} ไฟล์`);
}

function shareCourseFoldersWithInstructors() {
  const result = shareCourseFoldersWithInstructors_();
  notify_(`แชร์โฟลเดอร์แล้ว ${result.sharedCount} รายวิชา, ข้าม ${result.skippedCount} รายวิชา`);
}

function syncDriveLinksToSheet() {
  try {
    return syncDriveLinksToSheet_();
  } catch (error) {
    throw driveSyncAccessError_(error);
  }
}

function scanDriveLinksWithoutSharing() {
  try {
    return syncDriveLinksToSheet_(true);
  } catch (error) {
    throw driveSyncAccessError_(error);
  }
}

function syncDriveLinksToSheet_(keepDrivePermissions = false) {
  const sheet = getTargetSheet_();
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();

  if (lastRow <= headerRow) {
    notify_('ไม่พบข้อมูลรายวิชาในชีต');
    return;
  }

  const columns = getOrCreateColumns_(sheet);
  if (!keepDrivePermissions && DRIVE_SYNC_CONFIG.AUTO_CREATE_COURSE_FOLDERS) {
    ensureCourseFolders_(false, sheet, columns);
  }

  const lastColumn = sheet.getLastColumn();
  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  const rootFilesByCourseCode = driveSyncStep_('อ่านรายการไฟล์จากโฟลเดอร์ค้นหาที่ตั้งไว้', buildRootFileIndex_);

  let updatedCount = 0;
  let unmatchedCount = 0;
  let readErrorCount = 0;
  const now = new Date();

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const courseCode = normalizeCourseCode_(row[columns.courseCode - 1]);
    if (!courseCode) return;

    const existingFileId = row[columns.fileId - 1];
    const folderId = columns.folderId ? extractDriveId_(row[columns.folderId - 1]) : '';
    let file;
    try {
      file = folderId
        ? driveSyncStep_(`อ่านรายการไฟล์รายวิชา ${courseCode} แถว ${rowNumber}`, () => findLatestFileInFolder_(folderId))
        : rootFilesByCourseCode[courseCode];
    } catch (error) {
      if (!keepDrivePermissions) throw error;
      Logger.log(driveSyncAccessError_(error).message);
      readErrorCount += 1;
      return;
    }

    if (!file) { unmatchedCount += 1; return; }
    if (existingFileId && existingFileId === file.id) return;

    if (!keepDrivePermissions && DRIVE_SYNC_CONFIG.MAKE_FILES_VIEWABLE_BY_LINK) {
      driveSyncStep_(`ตั้งสิทธิ์เปิดไฟล์ของ ${courseCode} แถว ${rowNumber}`, () => makeFileViewableByLink_(file.id));
    }

    sheet.getRange(rowNumber, columns.fileLink).setValue(file.url);
    sheet.getRange(rowNumber, columns.upload).setValue(true);
    sheet.getRange(rowNumber, columns.fileId).setValue(file.id);
    sheet.getRange(rowNumber, columns.fileName).setValue(file.name);
    sheet.getRange(rowNumber, columns.foundAt).setValue(now);
    updatedCount += 1;
  });

  const summary = `อัปเดตลิงก์ไฟล์แล้ว ${updatedCount} รายวิชา`;
  notify_(keepDrivePermissions
    ? `${summary} (คงสิทธิ์เดิม) | ไม่พบไฟล์ ${unmatchedCount} | อ่านไม่ได้ ${readErrorCount}${readErrorCount ? '\nดูแถวที่อ่านไม่ได้ใน Apps Script > Executions' : ''}`
    : summary);
}

function driveSyncStep_(stage, operation) {
  try {
    return operation();
  } catch (error) {
    const annotated = new Error(String(error?.message || error));
    annotated.driveSyncStage = error?.driveSyncStage ? `${stage} > ${error.driveSyncStage}` : stage;
    throw annotated;
  }
}

function checkDriveSyncAccess() {
  try {
    DriveApp.getRootFolder().getName();
  } catch (error) {
    throw driveSyncAccessError_(error, 'อ่าน Drive ของบัญชีนี้ไม่สำเร็จ กรุณาตรวจรายละเอียดใน Apps Script > Executions');
  }

  // Inspect configured folders without creating a replacement or changing access.
  const rootId = extractDriveId_(DRIVE_SYNC_CONFIG.COURSE_ROOT_FOLDER_ID)
    || extractDriveId_(PropertiesService.getDocumentProperties()?.getProperty('DRIVE_SYNC_ROOT_FOLDER_ID'));
  const folderIds = [...new Set([rootId, ...DRIVE_SYNC_CONFIG.ROOT_FOLDER_IDS.map(extractDriveId_)].filter(Boolean))];
  folderIds.forEach(folderId => {
    try {
      DriveApp.getFolderById(folderId).getName();
    } catch (error) {
      throw driveSyncAccessError_(error, 'ใช้ Drive ได้ แต่อ่านโฟลเดอร์ที่ตั้งไว้ไม่สำเร็จ กรุณาตรวจ Folder ID และสิทธิ์ของบัญชีที่เปิดชีต');
    }
  });

  const driveStatus = folderIds.length
    ? `อ่าน Drive และโฟลเดอร์ที่ตั้งไว้ได้ ${folderIds.length} โฟลเดอร์`
    : 'อ่าน Drive ได้ ยังไม่มีโฟลเดอร์ที่ตั้งไว้ให้ตรวจ';
  let sheet;
  let courseCode;
  try {
    sheet = getTargetSheet_();
    ({ courseCode } = readDriveSyncHeaders_(sheet));
  } catch (error) {
    throw new Error(`${driveStatus}\nตรวจชีตไม่ผ่าน: ${error.message || error}`);
  }
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  notify_(`${driveStatus}\nแท็บ ${sheet.getName()} (gid=${sheet.getSheetId()}): พบคอลัมน์รหัสวิชาที่แถว ${headerRow} คอลัมน์ ${courseCode} (ยังไม่ได้ตรวจสิทธิ์แก้ไขไฟล์)`);
  return { checkedFolders: folderIds.length, sheetId: sheet.getSheetId(), headerRow, courseCodeColumn: courseCode };
}

function driveSyncAccessError_(error, fallbackMessage) {
  const detail = String(error?.message || error);
  const stage = error?.driveSyncStage;
  let guidance = fallbackMessage;
  if (/(?:access denied|ไม่ได้รับอนุญาตให้เข้าถึง)\s*:\s*DriveApp\b|domain policy.*disabled.*Drive/i.test(detail)) {
    guidance = 'Google ปฏิเสธการใช้ DriveApp กรุณาตรวจบัญชีที่เปิดชีต และให้ผู้ดูแล Google Workspace ตรวจนโยบาย Drive SDK/API ของบัญชีนี้ ไม่ต้องเปิดโฟลเดอร์เป็นสาธารณะ';
  } else if (/(?:authorization is required|required permissions|do not have permission to call|สิทธิ์ที่ต้องใช้)/i.test(detail)
    && (fallbackMessage || /DriveApp\b|googleapis\.com\/auth\/drive/i.test(detail))) {
    guidance = 'Apps Script ยังไม่ได้รับอนุญาตให้ใช้ Drive กรุณาเปิด Apps Script ด้วยบัญชีที่ใช้สแกน แล้ว Run checkDriveSyncAccess เพื่อตรวจและอนุญาตสิทธิ์';
  }
  if (stage?.startsWith('ตั้งสิทธิ์เปิดไฟล์')) {
    guidance = 'อ่านรายการไฟล์ผ่านแล้ว แต่เปิดไฟล์เพื่อตั้งสิทธิ์หรือเปลี่ยนสิทธิ์ไม่สำเร็จ ใช้เมนูสแกนและเติมลิงก์ (คงสิทธิ์ไฟล์) เพื่อเก็บลิงก์โดยไม่เปลี่ยนสิทธิ์';
  }
  return guidance || stage ? new Error(`${stage ? `ขั้นตอน: ${stage}\n` : ''}${guidance ? `${guidance}\n` : ''}รายละเอียด: ${detail}`) : error;
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

function deleteDriveSyncTriggers() {
  const handler = 'syncDriveLinksToSheet';
  let deletedCount = 0;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
      deletedCount += 1;
    }
  });

  notify_(`ปิด Trigger อัตโนมัติแล้ว ${deletedCount} รายการ`);
}

function getTargetSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('กรุณาเปิด Apps Script จากชีตสรุปรายวิชา');
  if (DRIVE_SYNC_CONFIG.SHEET_NAME) {
    const sheet = spreadsheet.getSheetByName(DRIVE_SYNC_CONFIG.SHEET_NAME);
    if (!sheet) throw new Error(`ไม่พบแท็บ "${DRIVE_SYNC_CONFIG.SHEET_NAME}" กรุณาตรวจ SHEET_NAME`);
    return sheet;
  }
  const sheetId = DRIVE_SYNC_CONFIG.SHEET_ID;
  if (!Number.isInteger(sheetId) || sheetId < 0) throw new Error('กรุณาตั้ง SHEET_ID เป็นเลข gid ของแท็บรายวิชา');
  const sheet = spreadsheet.getSheetById(sheetId);
  if (!sheet) throw new Error(`ไม่พบแท็บรายวิชา gid=${sheetId} กรุณาตรวจ SHEET_ID หรือ SHEET_NAME ไม่ได้สแกนแท็บอื่นแทน`);
  return sheet;
}

function readDriveSyncHeaders_(sheet) {
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  if (!Number.isInteger(headerRow) || headerRow < 1) throw new Error('กรุณาตั้ง HEADER_ROW เป็นเลขแถวหัวตาราง');
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn ? sheet.getRange(headerRow, 1, 1, lastColumn).getValues()[0] : [];

  const courseCode = findColumn_(headers, DRIVE_SYNC_CONFIG.COURSE_CODE_HEADERS);
  if (!courseCode) {
    throw new Error(`ไม่พบคอลัมน์รหัสวิชาในแท็บ "${sheet.getName()}" (gid=${sheet.getSheetId()}) แถว ${headerRow} กรุณาตรวจแท็บและ HEADER_ROW หัวข้อที่รองรับ: ${DRIVE_SYNC_CONFIG.COURSE_CODE_HEADERS.join(', ')}`);
  }
  return { headers, courseCode };
}

function getOrCreateColumns_(sheet) {
  const { headers, courseCode } = readDriveSyncHeaders_(sheet);
  return {
    courseCode,
    courseName: findColumn_(headers, DRIVE_SYNC_CONFIG.COURSE_NAME_HEADERS),
    instructorEmail: findColumn_(headers, DRIVE_SYNC_CONFIG.INSTRUCTOR_EMAIL_HEADERS),
    term: findColumn_(headers, DRIVE_SYNC_CONFIG.TERM_HEADERS),
    academicYear: findColumn_(headers, DRIVE_SYNC_CONFIG.ACADEMIC_YEAR_HEADERS),
    folderId: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FOLDER_ID_HEADERS[0]),
    folderLink: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FOLDER_LINK_HEADERS[0]),
    termFolderLink: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.TERM_FOLDER_LINK_HEADERS[0]),
    folderSharedWith: findOrCreateColumn_(sheet, headers, DRIVE_SYNC_CONFIG.FOLDER_SHARED_WITH_HEADERS[0]),
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

function ensureCourseFolders_(forceCreate, providedSheet, providedColumns) {
  const sheet = providedSheet || getTargetSheet_();
  const columns = providedColumns || getOrCreateColumns_(sheet);
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= headerRow) {
    return { createdCount: 0, existingCount: 0 };
  }

  const rootFolder = getOrCreateCourseRootFolder_();
  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  let createdCount = 0;
  let existingCount = 0;

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const courseCode = normalizeCourseCode_(row[columns.courseCode - 1]);
    if (!courseCode) return;

    const existingFolderId = extractDriveId_(row[columns.folderId - 1]);
    if (existingFolderId) {
      driveSyncStep_(`ตรวจโฟลเดอร์เดิมของ ${courseCode} แถว ${rowNumber}`, () => {
        const folder = DriveApp.getFolderById(existingFolderId);
        const termFolder = getCourseParentFolder_(rootFolder, row, columns);
        if (DRIVE_SYNC_CONFIG.AUTO_SHARE_COURSE_FOLDERS_WITH_INSTRUCTORS) {
          shareFolderWithInstructors_(folder, row, columns, sheet, rowNumber);
        }
        sheet.getRange(rowNumber, columns.folderLink).setValue(folder.getUrl());
        sheet.getRange(rowNumber, columns.termFolderLink).setValue(termFolder.getUrl());
        existingCount += 1;
      });
      return;
    }

    if (!forceCreate && !DRIVE_SYNC_CONFIG.AUTO_CREATE_COURSE_FOLDERS) return;

    const termFolder = getCourseParentFolder_(rootFolder, row, columns);
    const folderName = buildCourseFolderName_(row, columns);
    const folderResult = getOrCreateChildFolder_(termFolder, folderName);
    const folder = folderResult.folder;

    if (DRIVE_SYNC_CONFIG.MAKE_FOLDERS_VIEWABLE_BY_LINK) {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }

    if (DRIVE_SYNC_CONFIG.AUTO_SHARE_COURSE_FOLDERS_WITH_INSTRUCTORS) {
      shareFolderWithInstructors_(folder, row, columns, sheet, rowNumber);
    }

    sheet.getRange(rowNumber, columns.folderId).setValue(folder.getId());
    sheet.getRange(rowNumber, columns.folderLink).setValue(folder.getUrl());
    sheet.getRange(rowNumber, columns.termFolderLink).setValue(termFolder.getUrl());
    if (folderResult.created) {
      createdCount += 1;
    } else {
      existingCount += 1;
    }
  });

  return { createdCount, existingCount };
}

function moveExistingCourseFoldersToTermFolders_() {
  const sheet = getTargetSheet_();
  const columns = getOrCreateColumns_(sheet);
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= headerRow) {
    return { movedCount: 0, skippedCount: 0 };
  }

  const rootFolder = getOrCreateCourseRootFolder_();
  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  let movedCount = 0;
  let skippedCount = 0;

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const courseCode = normalizeCourseCode_(row[columns.courseCode - 1]);
    const folderId = extractDriveId_(row[columns.folderId - 1]);
    if (!courseCode || !folderId) {
      skippedCount += 1;
      return;
    }

    try {
      const folder = DriveApp.getFolderById(folderId);
      const termFolder = getCourseParentFolder_(rootFolder, row, columns);
      folder.moveTo(termFolder);
      sheet.getRange(rowNumber, columns.folderLink).setValue(folder.getUrl());
      sheet.getRange(rowNumber, columns.termFolderLink).setValue(termFolder.getUrl());
      movedCount += 1;
    } catch (error) {
      Logger.log(`Cannot move folder on row ${rowNumber}: ${error}`);
      skippedCount += 1;
    }
  });

  return { movedCount, skippedCount };
}

function shareCourseFoldersWithInstructors_() {
  const sheet = getTargetSheet_();
  const columns = getOrCreateColumns_(sheet);
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= headerRow) {
    return { sharedCount: 0, skippedCount: 0 };
  }

  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  let sharedCount = 0;
  let skippedCount = 0;

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const folderId = extractDriveId_(row[columns.folderId - 1]);

    if (!folderId || !columns.instructorEmail) {
      skippedCount += 1;
      return;
    }

    try {
      const folder = DriveApp.getFolderById(folderId);
      const emails = shareFolderWithInstructors_(folder, row, columns, sheet, rowNumber);
      if (emails.length > 0) {
        sharedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      Logger.log(`Cannot share folder on row ${rowNumber}: ${error}`);
      skippedCount += 1;
    }
  });

  return { sharedCount, skippedCount };
}

function getOrCreateCourseRootFolder_() {
  const configuredFolderId = extractDriveId_(DRIVE_SYNC_CONFIG.COURSE_ROOT_FOLDER_ID);
  if (configuredFolderId) return driveSyncStep_('เปิดโฟลเดอร์แม่ที่ตั้งไว้', () => DriveApp.getFolderById(configuredFolderId));

  const properties = PropertiesService.getDocumentProperties();
  const savedFolderId = properties.getProperty('DRIVE_SYNC_ROOT_FOLDER_ID');
  if (savedFolderId) return driveSyncStep_('เปิดโฟลเดอร์แม่ที่บันทึกไว้', () => DriveApp.getFolderById(savedFolderId));

  const folder = driveSyncStep_('สร้างโฟลเดอร์แม่', () => DriveApp.createFolder(DRIVE_SYNC_CONFIG.COURSE_ROOT_FOLDER_NAME));
  properties.setProperty('DRIVE_SYNC_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getCourseParentFolder_(rootFolder, row, columns) {
  if (!DRIVE_SYNC_CONFIG.GROUP_COURSE_FOLDERS_BY_TERM) {
    return rootFolder;
  }

  const termFolderName = buildTermFolderName_(row, columns);
  return getOrCreateChildFolder_(rootFolder, termFolderName).folder;
}

function getOrCreateChildFolder_(parentFolder, folderName) {
  const folder = driveSyncStep_(`ค้นหาโฟลเดอร์ ${folderName}`, () => {
    const existingFolders = parentFolder.getFoldersByName(folderName);
    return existingFolders.hasNext() ? existingFolders.next() : null;
  });
  return folder ? { folder, created: false }
    : { folder: driveSyncStep_(`สร้างโฟลเดอร์ ${folderName}`, () => parentFolder.createFolder(folderName)), created: true };
}

function buildCourseFolderName_(row, columns) {
  const courseCode = normalizeCourseCode_(row[columns.courseCode - 1]);
  const courseName = columns.courseName ? String(row[columns.courseName - 1] || '').trim() : '';
  const termYear = DRIVE_SYNC_CONFIG.GROUP_COURSE_FOLDERS_BY_TERM ? '' : buildTermFolderName_(row, columns);
  const parts = [termYear, courseCode, courseName].filter(Boolean);
  return sanitizeFolderName_(parts.join('_')).slice(0, 180);
}

function buildTermFolderName_(row, columns) {
  const term = columns.term ? String(row[columns.term - 1] || '').trim() : '';
  const academicYear = columns.academicYear ? String(row[columns.academicYear - 1] || '').trim() : '';

  if (academicYear && term) return sanitizeFolderName_(`${academicYear}_T${term}`);
  if (academicYear) return sanitizeFolderName_(`${academicYear}_ไม่ระบุเทอม`);
  if (term) return sanitizeFolderName_(`ไม่ระบุปี_T${term}`);
  return 'ไม่ระบุเทอม';
}

function sanitizeFolderName_(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|#{}%~&]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
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
  const folder = driveSyncStep_('เปิดโฟลเดอร์รายวิชา', () => DriveApp.getFolderById(folderId));
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
  const file = driveSyncStep_('เปิดไฟล์เพื่อเตรียมตั้งสิทธิ์', () => DriveApp.getFileById(fileId));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

function makeSheetLinkedFilesViewable_() {
  const sheet = getTargetSheet_();
  const columns = getOrCreateColumns_(sheet);
  const headerRow = DRIVE_SYNC_CONFIG.HEADER_ROW;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow <= headerRow) {
    return { updatedCount: 0, skippedCount: 0 };
  }

  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  let updatedCount = 0;
  let skippedCount = 0;

  values.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const fileId = extractDriveId_(row[columns.fileId - 1]) || extractDriveId_(row[columns.fileLink - 1]);

    if (!fileId) {
      skippedCount += 1;
      return;
    }

    try {
      makeFileViewableByLink_(fileId);
      updatedCount += 1;
    } catch (error) {
      Logger.log(`Cannot update file sharing on row ${rowNumber}: ${error}`);
      skippedCount += 1;
    }
  });

  return { updatedCount, skippedCount };
}

function shareFolderWithInstructors_(folder, row, columns, sheet, rowNumber) {
  if (!columns.instructorEmail) return [];

  const emails = extractEmails_(row[columns.instructorEmail - 1]);
  if (emails.length === 0) return [];

  const existingEditorEmails = new Set(
    folder.getEditors().map(user => user.getEmail().toLowerCase())
  );
  const newlySharedEmails = [];

  emails.forEach(email => {
    if (existingEditorEmails.has(email)) return;

    try {
      folder.addEditor(email);
      newlySharedEmails.push(email);
    } catch (error) {
      Logger.log(`Cannot add editor ${email} on row ${rowNumber}: ${error}`);
    }
  });

  sheet.getRange(rowNumber, columns.folderSharedWith).setValue(emails.join(', '));
  return newlySharedEmails;
}

function extractEmails_(value) {
  const text = String(value || '').trim();
  if (!text) return [];

  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map(email => email.toLowerCase()))];
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
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
}

function extractDriveId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const folderMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const fileMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  const queryMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];

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
