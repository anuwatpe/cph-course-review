const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../booking-course-picker.gs'), 'utf8');
const headers = ['รหัสวิชา', 'ชื่อรายวิชา', 'ชั้นปี', 'ภาคการศึกษา', 'ปีการศึกษา'];
const catalogRows = [headers,
    ['202300319', 'การวิจัยด้านสาธารณสุข 2', '3', '2', '2569'],
    ['202300205', 'พยาธิวิทยา', '1', '2', '2569'],
    ['202300205', 'พยาธิวิทยา', '2', '2', '2569'],
    ['GE 25302', 'ภาษาอังกฤษเชิงวิชาการ', '1', '2', '2569'],
    ['GE 25103', 'วิชาเทอมเก่า', '1', '1', '2569']
];
const scheduleRows = () => [
    ['ตารางเวลานำเสนอ 2-3/2569'],
    ['วันจันทร์ ที่ 2 พฤศจิกายน 2569'],
    ['ลำดับ', 'เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี', 'ผู้รับผิดชอบ', 'อีเมล', 'ไฟล์', 'สถานะ'],
    ['1', '09:00–09:20', '202300319', 'ชื่อเดิม', '3', 'อาจารย์เดิม', 'teacher@example.test', '=HYPERLINK("example", "ไฟล์")', 'FALSE'],
    ['2', '09:20–09:40', '', '', '', 'อาจารย์อื่น', '', 'คลิกที่นี่', 'FALSE'],
    ['', '10:20–10:30', '', 'พัก', '', '', '', '', ''],
    ['วันอังคาร ที่ 3 พฤศจิกายน 2569'],
    ['ลำดับ', 'เวลา', '', 'รายวิชา', '', 'ผู้รับผิดชอบ', '', 'ไฟล์', 'สถานะ'],
    ['3', '09:00–09:20', 'GE 25302', 'ภาษาอังกฤษ', '1', 'อาจารย์เดิม', '', 'คลิกที่นี่', 'FALSE']
];

function load(globals = {}) {
    const context = vm.createContext({ console, ...globals });
    new vm.Script(source, { filename: 'booking-course-picker.gs' }).runInContext(context);
    return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('catalog validates headers, filters empty records and removes exact duplicates', () => {
    const core = load().BookingCoursePicker;
    assert.equal(core.catalog([...catalogRows, catalogRows[1], ['', '', '', '', '']]).length, 5);
    assert.throws(() => core.catalog([['Please sign in']]));
    assert.throws(() => core.catalog([headers]));
});

test('dropdown only offers the semesters covered by the schedule', () => {
    const core = load().BookingCoursePicker;
    const options = core.choices(core.catalog(catalogRows), ['2/2569', '3/2569']);
    assert.equal(options.length, 4);
    assert.ok(!options.some(option => option.course.code === 'GE 25103'));
    assert.equal(options.find(option => option.course.code === '202300319').label, '202300319');
});

test('duplicate codes have distinct options that resolve regardless of the old class year', () => {
    const core = load().BookingCoursePicker;
    const options = core.choices(core.catalog(catalogRows), ['2/2569']);
    const option = options.find(option => option.course.code === '202300205' && option.course.level === '2');
    assert.match(option.label, /ปี 2/);
    const result = core.resolve(option.label, options, '1', false);
    assert.equal(result.kind, 'fill');
    assert.equal(result.course.level, '2');
    assert.equal(result.course.code, '202300205');
});

test('bare duplicate codes do not silently select the first class year', () => {
    const core = load().BookingCoursePicker;
    const options = core.choices(core.catalog(catalogRows), ['2/2569']);
    assert.equal(core.resolve('202300205', options, '1', false).kind, 'error');
    assert.equal(core.resolve('202300205', options, '2', true).course.level, '2');
    assert.equal(core.resolve('999999999', options, '', false).kind, 'error');
});

test('conflicting master records with the same code, level and term are rejected', () => {
    const core = load().BookingCoursePicker;
    const courses = core.catalog([...catalogRows, ['202300319', 'อีกชื่อที่ขัดแย้ง', '3', '2', '2569']]);
    assert.throws(() => core.choices(courses, ['2/2569']));
});

test('reads repeated blank column headers but excludes breaks and titles', () => {
    const core = load().BookingCoursePicker;
    const slots = core.slots(scheduleRows());
    assert.deepEqual(plain(slots.map(slot => slot.row)), [4, 5, 9]);
    assert.equal(slots[2].code, 2);
    assert.equal(slots[2].level, 4);
    assert.deepEqual(plain(slots[2].terms), ['2/2569', '3/2569']);
    const rows = scheduleRows();
    rows.push(['', '14:20–14:30', '', '', '']);
    assert.equal(core.slots(rows).length, 3);
});

test('supports explicit semester/year columns and rejects missing scope or headers', () => {
    const core = load().BookingCoursePicker;
    const rows = [
        ['เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี', 'ภาคการศึกษา', 'ปีการศึกษา'],
        ['09:00-09:20', '', '', '', '2', '2026']
    ];
    assert.deepEqual(plain(core.slots(rows)[0].terms), ['2/2569']);
    assert.throws(() => core.slots([['เวลา', 'รายวิชา'], ['09:00-09:20', 'วิชา']]));
    assert.throws(() => core.slots([['เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี'], ['09:00-09:20', '', '', '']]));
    assert.throws(() => core.slots([['ตาราง 3-2/2569']]));
});

class Range {
    constructor(sheet, row, col, height = 1, width = 1) { Object.assign(this, { sheet, row, col, height, width }); }
    getSheet() { return this.sheet; }
    getRow() { return this.row; }
    getColumn() { return this.col; }
    getLastRow() { return this.row + this.height - 1; }
    getLastColumn() { return this.col + this.width - 1; }
    getNumRows() { return this.height; }
    getDisplayValues() { return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width }, (_, c) => String(this.sheet.rows[this.row + r - 1]?.[this.col + c - 1] ?? ''))); }
    getDisplayValue() { return this.getDisplayValues()[0][0]; }
    setValue(value) { return this.setValues([[value]]); }
    setValues(values) {
        for (let r = 0; r < this.height; r++) {
            this.sheet.rows[this.row + r - 1] ||= [];
            for (let c = 0; c < this.width; c++) this.sheet.rows[this.row + r - 1][this.col + c - 1] = values[r][c];
        }
        return this;
    }
    clearContent() { return this.setValues(Array.from({ length: this.height }, () => Array(this.width).fill(''))); }
    setNumberFormat() { return this; }
    setNote(value) { this.sheet.notes[`${this.row}:${this.col}`] = value; return this; }
    getNote() { return this.sheet.notes[`${this.row}:${this.col}`] || ''; }
    setDataValidation(value) { this.sheet.validations[`${this.row}:${this.col}`] = value; return this; }
}
class Sheet {
    constructor(id, rows = []) { Object.assign(this, { id, rows: structuredClone(rows), notes: {}, validations: {} }); }
    getSheetId() { return this.id; }
    getLastRow() { return this.rows.length; }
    getDataRange() { return new Range(this, 1, 1, this.rows.length, Math.max(1, ...this.rows.map(row => row.length))); }
    getRange(row, col, height, width) {
        if (typeof row === 'string') {
            const match = row.match(/^([A-Z])([0-9]+)$/);
            return new Range(this, Number(match[2]), match[1].charCodeAt(0) - 64);
        }
        return new Range(this, row, col, height, width);
    }
    setFrozenRows() { return this; }
    hideSheet() { this.hidden = true; }
}

function fixture(rows = scheduleRows()) {
    const sheet = new Sheet(0, rows);
    const id = '196bNk_5oN-vo-zP0eiDTM610Oq09j7Pz4J50YPvOTKw';
    const sheets = new Map();
    let requests = 0;
    let unavailable = false;
    const notifications = [];
    const loggedErrors = [];
    const book = {
        getId: () => id, getSheetById: value => value === 0 ? sheet : null,
        getSheetByName: name => sheets.get(name),
        insertSheet: name => { const created = new Sheet(1); sheets.set(name, created); return created; },
        toast: message => notifications.push(message)
    };
    const triggers = [{ getHandlerFunction: () => 'syncDriveLinksToSheet', getTriggerSourceId: () => id }];
    const builder = () => {
        const result = { requireValueInList: values => { result.values = [...values]; return result; }, setAllowInvalid: () => result, setHelpText: () => result, build: () => result };
        return result;
    };
    const context = load({
        console: { error: error => loggedErrors.push(error.message) },
        SpreadsheetApp: {
            getActiveSpreadsheet: () => book, newDataValidation: builder,
            getUi: () => ({ createMenu: () => { const menu = { addItem: () => menu, addToUi: () => {} }; return menu; } })
        },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
        UrlFetchApp: { fetch: () => { requests++; return { getResponseCode: () => unavailable ? 503 : 200, getContentText: () => 'fixture' }; } },
        Utilities: { parseCsv: () => structuredClone(catalogRows) },
        ScriptApp: {
            getProjectTriggers: () => [...triggers],
            newTrigger: handler => { const trigger = { forSpreadsheet: () => trigger, onEdit: () => trigger, onOpen: () => trigger, create: () => triggers.push({ getHandlerFunction: () => handler, getTriggerSourceId: () => id }) }; return trigger; },
            deleteTrigger: target => triggers.splice(triggers.indexOf(target), 1)
        }
    });
    const edit = (row, col, value, oldValue) => {
        sheet.getRange(row, col).setValue(value);
        context.bookingCoursePickerOnEdit({ source: book, range: sheet.getRange(row, col), oldValue });
    };
    return { context, book, sheet, sheets, triggers, edit, requests: () => requests, notifications, loggedErrors, setUnavailable: () => { unavailable = true; } };
}

test('setup installs dropdowns and fills existing courses without touching times, breaks, files or instructors', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    assert.equal(f.sheet.rows[3][3], 'การวิจัยด้านสาธารณสุข 2');
    assert.equal(f.sheet.rows[3][4], 3);
    assert.deepEqual(Object.keys(f.sheet.validations), ['4:3', '5:3', '9:3']);
    assert.deepEqual(f.sheet.rows[3].slice(5), scheduleRows()[3].slice(5));
    assert.deepEqual(f.sheet.rows[5], scheduleRows()[5]);
    assert.equal(f.sheet.rows[3][1], '09:00–09:20');
    assert.equal(f.sheets.get('_BookingCourses').hidden, true);
    assert.equal(f.triggers.length, 3);
});

test('setup is idempotent and disabling only removes its own edit/open triggers', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.context.setupBookingCoursePicker();
    assert.equal(f.triggers.length, 3);
    f.context.disableBookingCoursePicker();
    assert.equal(f.triggers.length, 1);
    assert.equal(f.triggers[0].getHandlerFunction(), 'syncDriveLinksToSheet');
    assert.equal(f.sheet.rows[3][3], 'การวิจัยด้านสาธารณสุข 2');
});

test('selecting a duplicate option writes the canonical code and correct class using local catalog only', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    const option = f.sheet.validations['5:3'].values.find(value => value.includes('ปี 2'));
    f.edit(5, 3, option, '');
    assert.deepEqual(f.sheet.rows[4].slice(2, 5), ['202300205', 'พยาธิวิทยา', 2]);
    assert.ok(f.sheet.validations['5:3'].values.includes('202300205'));
    assert.equal(f.requests(), 1);
});

test('changing code updates derived fields; clearing code cancels without altering files or status', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.edit(4, 3, 'GE 25302', '202300319');
    assert.deepEqual(f.sheet.rows[3].slice(2, 5), ['GE 25302', 'ภาษาอังกฤษเชิงวิชาการ', 1]);
    f.edit(4, 3, '', 'GE 25302');
    assert.deepEqual(f.sheet.rows[3].slice(2, 5), ['', '', '']);
    assert.deepEqual(f.sheet.rows[3].slice(5), scheduleRows()[3].slice(5));
});

test('invalid pasted code clears stale derived fields and explains the mismatch', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.edit(4, 3, '999999999', '202300319');
    assert.deepEqual(f.sheet.rows[3].slice(3, 5), ['', '']);
    assert.match(f.sheet.notes['4:3'], /ไม่พบรหัสวิชา/);
});

test('multi-row paste fills all affected bookings and retains unrelated cell notes', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.sheet.notes['4:3'] = 'หมายเหตุจากอาจารย์';
    f.sheet.getRange(4, 3, 2, 1).setValues([['GE 25302'], ['202300319']]);
    f.context.bookingCoursePickerOnEdit({ source: f.book, range: f.sheet.getRange(4, 3, 2, 1) });
    assert.deepEqual(f.sheet.rows[3].slice(2, 5), ['GE 25302', 'ภาษาอังกฤษเชิงวิชาการ', 1]);
    assert.deepEqual(f.sheet.rows[4].slice(2, 5), ['202300319', 'การวิจัยด้านสาธารณสุข 2', 3]);
    f.edit(4, 3, 'invalid', 'GE 25302');
    assert.match(f.sheet.notes['4:3'], /^หมายเหตุจากอาจารย์\n/);
    f.edit(4, 3, '202300319', 'invalid');
    assert.equal(f.sheet.notes['4:3'], 'หมายเหตุจากอาจารย์');
});

test('semester selection is persisted when explicit columns exist, otherwise a cross-term collision is reported', () => {
    const f = fixture();
    const slot = { row: 5, code: 2, name: 3, level: 4, term: -1, year: -1 };
    const options = [2, 3].map(term => ({ label: `ตัวเลือกเทอม ${term}`, course: { code: '202300319', name: 'วิชาทดสอบ', level: '3', termYear: `${term}/2569` } }));
    const result = { kind: 'fill', course: options[1].course };
    assert.equal(f.context.bookingPickerApply_(f.sheet, slot, options, result, true).kind, 'error');
    assert.equal(f.sheet.rows[4][3], '');
    const applied = f.context.bookingPickerApply_(f.sheet, { ...slot, term: 9, year: 10 }, options, result, true);
    assert.equal(applied.kind, 'fill');
    assert.deepEqual(f.sheet.rows[4].slice(9, 11), [3, 2569]);
});

test('setup refuses to run from the wrong spreadsheet before writing data or installing triggers', () => {
    const f = fixture();
    f.book.getId = () => 'wrong-spreadsheet';
    assert.throws(() => f.context.setupBookingCoursePicker());
    assert.equal(f.requests(), 0);
    assert.equal(f.triggers.length, 1);
    assert.deepEqual(f.sheet.rows, scheduleRows());
});

test('unrelated edits and sheets do not fill or fetch anything', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.edit(4, 6, 'อาจารย์ใหม่', 'อาจารย์เดิม');
    assert.equal(f.requests(), 1);
    assert.equal(f.sheet.rows[3][5], 'อาจารย์ใหม่');
    f.context.bookingCoursePickerOnEdit({ source: { getId: () => 'other-book' }, range: f.sheet.getRange(4, 3) });
    f.context.bookingCoursePickerOnEdit({ source: f.book, range: new Sheet(99, scheduleRows()).getRange(4, 3) });
    assert.equal(f.requests(), 1);
});

test('opening refreshes choices; a source outage preserves the local catalog and manual name', () => {
    const f = fixture();
    f.context.setupBookingCoursePicker();
    f.sheet.rows[3][3] = 'ชื่อที่อาจารย์ปรับเอง';
    f.context.bookingCoursePickerOnOpen({ source: f.book });
    assert.equal(f.requests(), 2);
    assert.equal(f.sheet.rows[3][3], 'ชื่อที่อาจารย์ปรับเอง');
    const before = plain(f.sheets.get('_BookingCourses').rows);
    f.setUnavailable();
    f.context.bookingCoursePickerOnOpen({ source: f.book });
    assert.deepEqual(plain(f.sheets.get('_BookingCourses').rows), before);
    assert.match(f.notifications.at(-1), /อัปเดตรายวิชาไม่ได้/);
    f.edit(5, 3, 'GE 25302', '');
    assert.equal(f.sheet.rows[4][3], 'ภาษาอังกฤษเชิงวิชาการ');
});

test('setup preserves name-only reservations and refuses to overwrite an unrelated catalog tab', () => {
    const rows = scheduleRows();
    rows[4][3] = 'วิชาที่กรอกด้วยชื่อไว้ก่อน';
    const f = fixture(rows);
    f.context.setupBookingCoursePicker();
    assert.equal(f.sheet.rows[4][3], rows[4][3]);
    const other = fixture();
    other.sheets.set('_BookingCourses', new Sheet(1, [['ข้อมูลของผู้ใช้']]));
    assert.throws(() => other.context.setupBookingCoursePicker());
    assert.equal(other.sheets.get('_BookingCourses').rows[0][0], 'ข้อมูลของผู้ใช้');
    assert.equal(other.triggers.length, 1);
});
