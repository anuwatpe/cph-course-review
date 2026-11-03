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
    assert.ok(f.menuItems.some(item => item.handler === 'scanDriveLinksWithoutSharing'));
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

function scanFixture(rows = [['202300319', 'course-folder', '', '', '', '', '']]) {
    const f = fixture();
    const writes = [];
    const findLatestFile = f.context.findLatestFileInFolder_;
    f.context.getTargetSheet_ = () => ({
        getLastRow: () => rows.length + 1, getLastColumn: () => 7,
        getRange: (row, column, height) => height
            ? { getValues: () => rows }
            : { setValue: value => writes.push({ row, column, value }) }
    });
    f.context.getOrCreateColumns_ = () => ({ courseCode: 1, folderId: 2, fileId: 3, fileLink: 4, upload: 5, fileName: 6, foundAt: 7 });
    f.context.findLatestFileInFolder_ = id => {
        assert.equal(id, 'course-folder');
        return { id: 'file-id', url: 'https://drive.google.com/file/d/file-id/view', name: 'มคอ.3.pdf' };
    };
    return { ...f, writes, findLatestFile };
}

test('a successful scan still fills the file link and status without invoking the diagnostic', () => {
    const f = scanFixture();
    const permissions = [];
    f.config.AUTO_CREATE_COURSE_FOLDERS = false;
    f.context.makeFileViewableByLink_ = id => permissions.push(id);
    f.context.syncDriveLinksToSheet();
    assert.deepEqual(f.writes.slice(0, 4).map(write => write.value), ['https://drive.google.com/file/d/file-id/view', true, 'file-id', 'มคอ.3.pdf']);
    assert.equal(f.writes.length, 5);
    assert.deepEqual(permissions, ['file-id']);
    assert.deepEqual(f.reads, []);
});

test('manual scan preserves Drive permissions, skips inaccessible rows and fills accessible links', () => {
    const f = scanFixture([
        ['202300319', 'course-folder', '', '', '', '', ''],
        ['202300320', 'blocked-folder', '', '', '', '', ''],
        ['202300321', '', '', '', '', '', '']
    ]);
    const read = f.context.findLatestFileInFolder_;
    f.config.AUTO_CREATE_COURSE_FOLDERS = true;
    f.config.AUTO_SHARE_COURSE_FOLDERS_WITH_INSTRUCTORS = true;
    f.config.MAKE_FILES_VIEWABLE_BY_LINK = true;
    f.context.ensureCourseFolders_ = () => assert.fail('must not create or share folders');
    f.context.makeFileViewableByLink_ = () => assert.fail('must not set file sharing');
    f.context.findLatestFileInFolder_ = id => {
        if (id === 'blocked-folder') throw new Error('Access denied: DriveApp');
        return read(id);
    };
    f.context.scanDriveLinksWithoutSharing();
    assert.equal(f.writes.length, 5);
    assert.ok(f.writes.every(write => write.row === 2));
    assert.match(f.logs.join('\n'), /อ่านรายการไฟล์รายวิชา 202300320 แถว 3/);
    assert.match(f.logs.at(-1), /ไม่พบไฟล์ 1 \| อ่านไม่ได้ 1/);
});

test('normal scan identifies a blocked sharing operation and does not record an unprocessed file', () => {
    const f = scanFixture(); f.config.AUTO_CREATE_COURSE_FOLDERS = false;
    f.context.DriveApp.getFileById = () => ({ setSharing: () => { throw new Error('Access denied: DriveApp'); } });
    f.context.DriveApp.Access = { ANYONE_WITH_LINK: 'anyone' };
    f.context.DriveApp.Permission = { VIEW: 'view' };
    assert.throws(f.context.syncDriveLinksToSheet, /ตั้งสิทธิ์เปิดไฟล์ของ 202300319 แถว 2[\s\S]*คงสิทธิ์ไฟล์/);
    assert.deepEqual(f.writes, []);
});

test('normal scan keeps row and operation context when a course folder cannot be opened', () => {
    const f = scanFixture(); f.config.AUTO_CREATE_COURSE_FOLDERS = false;
    f.context.findLatestFileInFolder_ = f.findLatestFile;
    f.context.DriveApp.getFolderById = () => { throw new Error('Access denied: DriveApp'); };
    assert.throws(f.context.syncDriveLinksToSheet, /อ่านรายการไฟล์รายวิชา 202300319 แถว 2 > เปิดโฟลเดอร์รายวิชา/);
    assert.deepEqual(f.writes, []);
});

test('an inaccessible existing folder is not replaced by an automatically created folder', () => {
    const f = scanFixture();
    f.context.DriveApp.getFolderById = id => {
        if (id === 'course-folder') throw new Error('Access denied: DriveApp');
        return {};
    };
    f.context.getOrCreateChildFolder_ = () => assert.fail('must not replace an inaccessible folder');
    assert.throws(f.context.syncDriveLinksToSheet, /ตรวจโฟลเดอร์เดิมของ 202300319 แถว 2/);
    assert.deepEqual(f.writes, []);
});
