const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../google-drive-sheet-sync.gs'), 'utf8');

const summaryHeaders = ['ลำดับ', 'ปีการศึกษา', 'ภาคการศึกษา', 'ชั้นปี', 'หมวดวิชา', 'หลักสูตร', 'รหัสวิชา', 'ชื่อรายวิชา'];

function fixture({ driveError, folderError, savedRoot = '', headers = summaryHeaders } = {}) {
    const reads = [];
    const logs = [];
    const menuItems = [];
    const forbidden = () => { throw new Error('Unexpected write or automation'); };
    const sheet = {
        getName: () => 'รายวิชา', getSheetId: () => 486231050,
        getLastRow: () => 2, getLastColumn: () => headers.length,
        getRange: (row, column, height, width) => {
            assert.equal(column, 1); assert.equal(height, 1); assert.equal(width, headers.length);
            return { getValues: () => [row === 1 ? [...headers] : []], setValue: forbidden };
        }
    };
    const book = {
        toast() {}, getActiveSheet: forbidden,
        getSheetById: id => id === sheet.getSheetId() ? sheet : null,
        getSheetByName: name => name === sheet.getName() ? sheet : null
    };
    const context = vm.createContext({
        Logger: { log: value => logs.push(value) },
        SpreadsheetApp: { getActiveSpreadsheet: () => book, getUi: () => ({ createMenu: () => {
            const menu = { addItem: (label, handler) => { menuItems.push({ label, handler }); return menu; }, addToUi() {} };
            return menu;
        } }) },
        DriveApp: {
            getRootFolder: () => ({ getName: () => { reads.push('my-drive'); if (driveError) throw driveError; return 'My Drive'; } }),
            getFolderById: id => ({ getName: () => { reads.push(id); if (folderError) throw folderError; return 'Folder'; } }),
            createFolder: forbidden, getFileById: forbidden
        },
        PropertiesService: { getDocumentProperties: () => ({ getProperty: () => savedRoot, setProperty: forbidden }) },
        MailApp: { sendEmail: forbidden },
        ScriptApp: { newTrigger: forbidden, deleteTrigger: forbidden }
    });
    vm.runInContext(source, context, { filename: 'google-drive-sheet-sync.gs' });
    return { context, reads, logs, menuItems, sheet, config: vm.runInContext('DRIVE_SYNC_CONFIG', context) };
}

test('opening the menu registers the diagnostic but does not read Drive or start a scan', () => {
    const f = fixture();
    f.context.onOpen();
    assert.ok(f.menuItems.some(item => item.handler === 'checkDriveSyncAccess'));
    assert.ok(f.menuItems.some(item => item.handler === 'syncDriveLinksToSheet'));
    assert.deepEqual(f.reads, []);
});

test('diagnostic only reads Drive and the configured folders, with duplicate IDs removed', () => {
    const f = fixture();
    f.config.ROOT_FOLDER_IDS = [`https://drive.google.com/drive/folders/${f.config.COURSE_ROOT_FOLDER_ID}`, 'fallback-folder'];
    const result = f.context.checkDriveSyncAccess();
    assert.equal(result.checkedFolders, 2);
    assert.equal(result.sheetId, 486231050);
    assert.equal(result.headerRow, 1);
    assert.equal(result.courseCodeColumn, 7);
    assert.deepEqual(f.reads, ['my-drive', f.config.COURSE_ROOT_FOLDER_ID, 'fallback-folder']);
    assert.match(f.logs[0], /ยังไม่ได้ตรวจสิทธิ์แก้ไขไฟล์/);
});

test('Drive Sync selects the summary tab by gid, even if an unrelated tab is active', () => {
    const f = fixture();
    assert.equal(f.context.getTargetSheet_(), f.sheet);
    f.config.SHEET_ID = 99;
    assert.throws(f.context.syncDriveLinksToSheet, /gid=99.*ไม่ได้สแกนแท็บอื่นแทน/);
    assert.deepEqual(f.reads, []);
});

test('a configured tab name overrides the default gid and an invalid name fails closed', () => {
    const f = fixture(); f.config.SHEET_ID = 99;
    f.config.SHEET_NAME = 'รายวิชา';
    assert.equal(f.context.getTargetSheet_(), f.sheet);
    f.config.SHEET_NAME = 'แท็บที่ไม่มี';
    assert.throws(f.context.getTargetSheet_, /ไม่พบแท็บ.*SHEET_NAME/);
});

test('missing headers identify the exact tab and row before a scan can write or access Drive', () => {
    const f = fixture({ headers: ['หัวเรื่อง', 'ชื่อรายวิชา'] });
    assert.throws(f.context.syncDriveLinksToSheet, /ไม่พบคอลัมน์รหัสวิชา.*รายวิชา.*gid=486231050.*แถว 1/);
    assert.deepEqual(f.reads, []);
    assert.throws(f.context.checkDriveSyncAccess, /อ่าน Drive[\s\S]*ตรวจชีตไม่ผ่าน/);
});

test('the diagnostic validates the configured header row without creating columns', () => {
    const f = fixture(); f.config.HEADER_ROW = 2;
    assert.throws(f.context.checkDriveSyncAccess, /ตรวจชีตไม่ผ่าน.*แถว 2/);
    f.config.HEADER_ROW = 1;
    assert.equal(f.context.checkDriveSyncAccess().courseCodeColumn, 7);
});

test('header matching ignores invisible separators but does not guess similarly named columns', () => {
    const f = fixture({ headers: ['รหัสวิชาเดิม', '\uFEFFรหัส\u200Bวิชา\u2060', 'ชื่อรายวิชา'] });
    assert.equal(f.context.readDriveSyncHeaders_(f.sheet).courseCode, 2);
    const blank = fixture({ headers: [] });
    assert.throws(() => blank.context.readDriveSyncHeaders_(blank.sheet), /ไม่พบคอลัมน์รหัสวิชา/);
});

test('diagnostic can inspect a previously saved root, but never creates a missing one', () => {
    const saved = fixture({ savedRoot: 'existing-root' }); saved.config.COURSE_ROOT_FOLDER_ID = '';
    assert.equal(saved.context.checkDriveSyncAccess().checkedFolders, 1);
    assert.deepEqual(saved.reads, ['my-drive', 'existing-root']);
    const missing = fixture(); missing.config.COURSE_ROOT_FOLDER_ID = '';
    assert.equal(missing.context.checkDriveSyncAccess().checkedFolders, 0);
    assert.deepEqual(missing.reads, ['my-drive']);
});

test('DriveApp service denial in English and Thai stops before any folder lookup', () => {
    for (const message of ['Access denied: DriveApp', 'ไม่ได้รับอนุญาตให้เข้าถึง: DriveApp', 'The domain policy has disabled third-party Drive apps']) {
        const f = fixture({ driveError: new Error(message) });
        assert.throws(f.context.checkDriveSyncAccess, error => /นโยบาย Drive SDK\/API/.test(error.message) && error.message.includes(message));
        assert.deepEqual(f.reads, ['my-drive']);
    }
});

test('missing OAuth authorization and inaccessible folders get distinct guidance', () => {
    const auth = fixture({ driveError: new Error('You do not have permission to call DriveApp.getRootFolder. Required permissions: https://www.googleapis.com/auth/drive') });
    assert.throws(auth.context.checkDriveSyncAccess, /Run checkDriveSyncAccess/);
    const folder = fixture({ folderError: new Error('No item with the given ID could be found') });
    assert.throws(folder.context.checkDriveSyncAccess, /ใช้ Drive ได้ แต่อ่านโฟลเดอร์ที่ตั้งไว้ไม่สำเร็จ/);
    assert.deepEqual(folder.reads, ['my-drive', folder.config.COURSE_ROOT_FOLDER_ID]);
});

test('the existing scan handler explains DriveApp denial without hiding unrelated errors', () => {
    const f = fixture();
    f.context.syncDriveLinksToSheet_ = () => { throw new Error('Access denied: DriveApp'); };
    assert.throws(f.context.syncDriveLinksToSheet, /นโยบาย Drive SDK\/API/);
    const unrelated = new Error('Missing course code column');
    f.context.syncDriveLinksToSheet_ = () => { throw unrelated; };
    assert.throws(f.context.syncDriveLinksToSheet, error => error === unrelated);
});

test('a successful scan still fills the file link and status without invoking the diagnostic', () => {
    const f = fixture();
    const writes = [];
    const permissions = [];
    f.config.AUTO_CREATE_COURSE_FOLDERS = false;
    f.context.getTargetSheet_ = () => ({
        getLastRow: () => 2, getLastColumn: () => 7,
        getRange: (row, column, height) => height
            ? { getValues: () => [['202300319', 'course-folder', '', '', '', '', '']] }
            : { setValue: value => writes.push({ row, column, value }) }
    });
    f.context.getOrCreateColumns_ = () => ({ courseCode: 1, folderId: 2, fileId: 3, fileLink: 4, upload: 5, fileName: 6, foundAt: 7 });
    f.context.findLatestFileInFolder_ = id => {
        assert.equal(id, 'course-folder');
        return { id: 'file-id', url: 'https://drive.google.com/file/d/file-id/view', name: 'มคอ.3.pdf' };
    };
    f.context.makeFileViewableByLink_ = id => permissions.push(id);
    f.context.syncDriveLinksToSheet();
    assert.deepEqual(writes.slice(0, 4).map(write => write.value), ['https://drive.google.com/file/d/file-id/view', true, 'file-id', 'มคอ.3.pdf']);
    assert.equal(writes.length, 5);
    assert.deepEqual(permissions, ['file-id']);
    assert.deepEqual(f.reads, []);
});
