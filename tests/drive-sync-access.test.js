const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../google-drive-sheet-sync.gs'), 'utf8');

function fixture({ driveError, folderError, savedRoot = '' } = {}) {
    const reads = [];
    const logs = [];
    const menuItems = [];
    const forbidden = () => { throw new Error('Unexpected write or automation'); };
    const book = { toast() {}, getActiveSheet: forbidden };
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
    return { context, reads, logs, menuItems, config: vm.runInContext('DRIVE_SYNC_CONFIG', context) };
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
    assert.equal(f.context.checkDriveSyncAccess().checkedFolders, 2);
    assert.deepEqual(f.reads, ['my-drive', f.config.COURSE_ROOT_FOLDER_ID, 'fallback-folder']);
    assert.match(f.logs[0], /ยังไม่ได้ตรวจสิทธิ์แก้ไขไฟล์/);
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
