const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(require.resolve('../course-reminders.gs'), 'utf8');
const bookingSource = fs.readFileSync(require.resolve('../booking-sync.js'), 'utf8');
const driveSource = fs.readFileSync(require.resolve('../google-drive-sheet-sync.gs'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const summaryRows = () => [
    ['รหัสวิชา', 'ชื่อรายวิชา', 'ชั้นปี', 'ภาคการศึกษา', 'ปีการศึกษา', 'ผู้รับผิดชอบ', 'อีเมล', 'อัพไฟล์', 'ลิงก์ไฟล์', 'อัพไฟล์ 5-6', 'ลิงค์ไฟล์ มคอ. 5-6', 'ลิงก์โฟลเดอร์อัปโหลด'],
    ['202300319', 'การวิจัยด้านสาธารณสุข 2', '3', '2', '2569', 'อาจารย์หนึ่ง', 'Faculty@school.test', 'FALSE', '', 'FALSE', '', 'https://drive.google.com/drive/folders/first'],
    ['GE 25302', 'ภาษาอังกฤษเชิงวิชาการ', '1', '2', '2569', 'อาจารย์หนึ่ง', 'faculty@school.test', 'FALSE', '', 'FALSE', '', ''],
    ['GE 104', 'วิชาเก่า', '1', '1', '2569', 'อาจารย์เก่า', 'old@school.test', 'FALSE', '', 'FALSE', '', '']
];
const scheduleRows = () => [
    ['ตารางเวลานำเสนอ 2-3/2569'],
    ['วันจันทร์ ที่ 2 พฤศจิกายน 2569'],
    ['ลำดับ', 'เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี'],
    ['1', '09:00-09:20', '202300319', 'การวิจัยด้านสาธารณสุข 2', '3'],
    ['2', '09:20-09:40', '', '', '']
];

class Range {
    constructor(sheet, row, column, height = 1, width = 1) { Object.assign(this, { sheet, row, column, height, width }); }
    getValues() { return Array.from({ length: this.height }, (_, r) => Array.from({ length: this.width }, (_, c) => this.sheet.rows[this.row + r - 1]?.[this.column + c - 1] ?? '')); }
    getDisplayValues() { return this.getValues().map(row => row.map(String)); }
    getDisplayValue() { return this.getDisplayValues()[0][0]; }
    getRichTextValues() { return this.getValues().map((row, r) => row.map((_, c) => ({ getLinkUrl: () => this.sheet.links[`${this.row + r}:${this.column + c}`] || '', getRuns: () => [] }))); }
    setValues(values) {
        if (this.sheet.failSent && this.column === 6 && values[0][0] === 'SENT') throw new Error('Simulated log failure');
        for (let r = 0; r < this.height; r++) {
            this.sheet.rows[this.row + r - 1] ||= [];
            for (let c = 0; c < this.width; c++) this.sheet.rows[this.row + r - 1][this.column + c - 1] = values[r][c];
        }
        return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
}
class Sheet {
    constructor(id, rows = []) { Object.assign(this, { id, rows: structuredClone(rows), links: {} }); }
    getSheetId() { return this.id; }
    getLastRow() { return this.rows.length; }
    getRange(...args) { return new Range(this, ...args); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.rows.length), Math.max(1, ...this.rows.map(row => row.length))); }
    setFrozenRows() { return this; }
    setColumnWidth() { return this; }
}
function properties() {
    const values = new Map();
    return { getProperty: key => values.get(key) || null, setProperty: (key, value) => values.set(key, value), getProperties: () => Object.fromEntries(values), values };
}

function fixture() {
    const sheet = new Sheet(486231050, summaryRows());
    const sheets = new Map();
    const state = { now: Date.parse('2026-11-02T02:00:00Z'), actor: 'owner@school.test', owner: 'owner@school.test', quota: 100, http: 200, schedule: scheduleRows(), fetches: 0, locked: false, failMail: false, triggerCalls: 0, mails: [], menus: [], loggedErrors: [], confirm: 'NO' };
    const doc = properties();
    const users = new Map();
    const caches = new Map();
    const user = () => { if (!users.has(state.actor)) users.set(state.actor, properties()); return users.get(state.actor); };
    const cache = () => {
        if (!caches.has(state.actor)) caches.set(state.actor, new Map());
        const values = caches.get(state.actor);
        return {
            get: key => { const item = values.get(key); return item && item.expiry > state.now ? item.value : null; },
            put: (key, value, seconds) => values.set(key, { value, expiry: state.now + seconds * 1000 }),
            remove: key => values.delete(key)
        };
    };
    const book = {
        getId: () => state.bookId || 'summary-book', getOwner: () => state.owner ? { getEmail: () => state.owner } : null,
        getSheetById: id => id === sheet.id ? sheet : null,
        getSheetByName: name => sheets.get(name),
        insertSheet: name => { const created = new Sheet(100); sheets.set(name, created); return created; },
        toast() {}, setActiveSheet: target => { state.activeSheet = target; }
    };
    const ui = {
        Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL', YES_NO_CANCEL: 'YES_NO_CANCEL' },
        createMenu: name => { const menu = { addItem: () => menu, addToUi: () => state.menus.push(name) }; return menu; },
        prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => 'faculty@school.test' }),
        alert: () => state.confirm, showModalDialog() {}
    };
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [state.now])); }
        static now() { return state.now; }
    }
    const context = vm.createContext({
        Date: ClockDate,
        console: { error: error => state.loggedErrors.push(String(error)) },
        Logger: { log() {} },
        SpreadsheetApp: {
            getActiveSpreadsheet: () => book, getUi: () => ui, flush() {},
            openById: () => {
                state.fetches++;
                if (state.http !== 200) throw new Error('Booking spreadsheet unavailable');
                return { getSheetById: id => id === 0 ? { getDataRange: () => ({ getDisplayValues: () => structuredClone(state.schedule) }) } : null };
            }
        },
        Session: { getActiveUser: () => ({ getEmail: () => state.actor }) },
        PropertiesService: { getDocumentProperties: () => doc, getUserProperties: user },
        CacheService: { getUserCache: cache },
        LockService: { getDocumentLock: () => ({ tryLock: () => { if (state.locked) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
        Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()] },
        MailApp: { getRemainingDailyQuota: () => state.quota, sendEmail: message => {
            state.mails.push(plain(message));
            if (state.duringMail) state.duringMail();
            if (state.failMail) throw new Error('Simulated mail failure');
        } },
        ScriptApp: { newTrigger: () => { state.triggerCalls++; throw new Error('No triggers allowed'); } }
    });
    vm.runInContext(bookingSource, context, { filename: 'booking-sync.js' });
    vm.runInContext(source, context, { filename: 'course-reminders.gs' });
    const selected = { terms: ['2/2569'], booking: true, upload34: true, upload56: false };
    const setup = () => context.setupApcrisReminders();
    const preview = options => context.getApcrisReminderPreview({ ...selected, ...options });
    const send = plan => context.sendApcrisReminders({ token: plan.token, confirmed: true, emails: plan.groups.filter(group => group.eligible).map(group => group.email) });
    return { context, state, sheet, sheets, book, doc, caches, selected, setup, preview, send, core: context.ApcrisReminders, log: () => sheets.get('_APCRIS_ReminderLog') };
}

test('setup is manual-only, idempotent, leaves source data intact and never creates a trigger', () => {
    const f = fixture(); f.setup(); f.setup();
    assert.equal(f.sheets.size, 1); assert.deepEqual(f.sheet.rows, summaryRows());
    assert.equal(f.state.mails.length, 0); assert.equal(f.state.triggerCalls, 0);
    assert.throws(() => f.context.setupApcrisReminders({ triggerUid: 'old' }), /ด้วยการกด/);
    assert.ok(!/ScriptApp|newTrigger|timeBased|everyDays|onEdit\(/.test(source));
});

test('opening the existing Drive Sync menu adds reminder commands but never sends', () => {
    const f = fixture();
    vm.runInContext(driveSource, f.context);
    f.context.onOpen();
    assert.deepEqual(f.state.menus, ['Drive Sync', 'APCRIS แจ้งเตือน']);
    assert.equal(f.state.mails.length, 0); assert.equal(f.state.triggerCalls, 0);
});

test('installation refuses the booking spreadsheet, a missing source tab and an unrelated log tab', () => {
    const f = fixture(); f.state.bookId = '196bNk_5oN-vo-zP0eiDTM610Oq09j7Pz4J50YPvOTKw';
    assert.throws(f.setup, /ไม่ใช่ชีตลงเวลา/);
    f.state.bookId = ''; f.sheet.id = 5;
    assert.throws(f.setup, /SUMMARY_SHEET_ID/);
    f.sheet.id = 486231050; f.sheets.set('_APCRIS_ReminderLog', new Sheet(100, [['unrelated']]));
    assert.throws(f.setup, /ชื่อซ้ำ/);
    assert.equal(f.state.mails.length, 0);
});

test('only the owner or configured admins can install, preview or send; blank identity fails closed', () => {
    const f = fixture(); f.state.actor = 'editor@school.test';
    assert.throws(f.setup, /ผู้ดูแล/);
    f.state.actor = 'owner@school.test'; f.setup();
    const plan = f.preview(); f.state.actor = '';
    assert.throws(() => f.preview(), /ผู้ดูแล/);
    assert.throws(() => f.send(plan), /ผู้ดูแล/);
    assert.equal(f.state.mails.length, 0);
});

test('preview uses actual bookings, groups all pending courses per normalized email and excludes old terms', () => {
    const f = fixture(); f.setup(); const plan = f.preview();
    assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].email, 'faculty@school.test');
    assert.equal(plan.groups[0].items.length, 2);
    assert.deepEqual(plain(plan.groups[0].items.find(item => item.id === '202300319').reasons), ['ยังไม่ส่ง มคอ.3-4']);
    assert.deepEqual(plain(plan.groups[0].items.find(item => item.id === 'GE 25302').reasons), ['ยังไม่ลงเวลา', 'ยังไม่ส่ง มคอ.3-4']);
    assert.equal(f.state.mails.length, 0);
});

test('terms and at least one reminder type must be explicitly selected; unsupported booking terms are rejected', () => {
    const f = fixture(); f.setup();
    assert.throws(() => f.preview({ terms: [] }), /เลือกภาค/);
    assert.throws(() => f.preview({ booking: false, upload34: false }), /เลือกงาน/);
    assert.throws(() => f.preview({ terms: ['1/2569'] }), /ไม่ครอบคลุม/);
    assert.throws(() => f.preview({ terms: ['4/2569'] }), /ไม่ถูกต้อง/);
    assert.equal(f.state.mails.length, 0);
});

test('upload flags or links count as submitted and 5-6 is only checked when explicitly selected', () => {
    const f = fixture(); f.setup();
    f.sheet.rows[1][7] = 'TRUE'; f.sheet.rows[2][8] = 'https://drive.google.com/file/d/test/view';
    const complete34 = f.preview({ booking: false });
    assert.equal(complete34.groups.length, 0);
    const pending56 = f.preview({ booking: false, upload34: false, upload56: true });
    assert.equal(pending56.groups[0].items.length, 2);
    assert.deepEqual(plain(pending56.groups[0].items[0].reasons), ['ยังไม่ส่ง มคอ.5-6']);
    f.sheet.rows[1][8] = ''; f.sheet.rows[1][7] = 'FALSE';
    f.sheet.links['2:9'] = 'https://drive.google.com/file/d/rich/view';
    assert.equal(f.preview({ booking: false }).groups.length, 0);
});

test('missing upload columns, duplicate course identities and invalid deadlines fail before any send', () => {
    const f = fixture(); f.setup();
    assert.throws(() => f.preview({ bookingDeadline: '2026-02-30' }), /กำหนดส่ง/);
    f.sheet.rows.push(structuredClone(f.sheet.rows[1]));
    assert.throws(f.preview, /รายวิชาซ้ำ/); f.sheet.rows.pop();
    f.sheet.rows[0][7] = 'unknown'; f.sheet.rows[0][8] = 'unknown2';
    assert.throws(f.preview, /มคอ.3-4/);
    assert.equal(f.state.mails.length, 0);
});

test('ambiguous or unmatched schedule records block booking reminders rather than guessing', () => {
    const f = fixture(); f.setup();
    f.state.schedule[3][2] = 'WRONG';
    assert.throws(f.preview, /จับคู่รายวิชาไม่ได้/);
    f.state.schedule = scheduleRows(); f.state.schedule[3][4] = '';
    const duplicate = structuredClone(f.sheet.rows[1]); duplicate[2] = '2'; f.sheet.rows.push(duplicate);
    assert.throws(f.preview, /จับคู่รายวิชาไม่ได้/);
});

test('a booking outage never falls back to stale flags; document-only reminders do not fetch bookings', () => {
    const f = fixture(); f.setup(); f.state.http = 503;
    assert.throws(f.preview, /อ่านชีตลงเวลา/); assert.equal(f.state.mails.length, 0);
    const fetches = f.state.fetches;
    assert.equal(f.preview({ booking: false }).groups.length, 1);
    assert.equal(f.state.fetches, fetches);
    f.state.http = 200; f.state.schedule = [['ตารางรูปแบบไม่ถูกต้อง']];
    assert.throws(f.preview, /หัวคอลัมน์/);
});

test('missing and malformed emails are reported; valid co-instructors get separate private messages', () => {
    const f = fixture(); f.setup();
    f.sheet.rows[1][6] = 'second@school.test, wrong-address'; f.sheet.rows[2][6] = '';
    const plan = f.preview();
    assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].email, 'second@school.test');
    assert.equal(plan.warnings.length, 2);
    f.sheet.rows[1][6] = 'faculty@school.test;second@school.test';
    f.send(f.preview());
    assert.equal(f.state.mails.length, 2);
    assert.ok(f.state.mails.every(mail => !mail.cc && !mail.bcc && !mail.to.includes(',')));
});

test('email bodies escape source HTML, reject unsafe links, and include only selected issues and deadlines', () => {
    const f = fixture(); f.setup();
    f.sheet.rows[1][1] = '<img src=x onerror=alert(1)>'; f.sheet.rows[1][11] = 'javascript:alert(1)';
    const plan = f.preview({ bookingDeadline: '2026-11-05', uploadDeadline: '2026-11-06' });
    const message = plan.groups[0].message;
    assert.match(message.subject, /^\[APCRIS\]/); assert.match(message.body, /5\/11\/2569/);
    assert.match(message.body, /6\/11\/2569/); assert.ok(!message.htmlBody.includes('<img src=x'));
    assert.ok(!message.htmlBody.includes('javascript:')); assert.match(message.htmlBody, /&lt;img/);
    assert.equal(f.core.safeUrl('https://name:password@example.test'), '');
    assert.equal(f.core.safeUrl('data:text/html,hi'), '');
});

test('sending requires a fresh, explicit manual confirmation and a server-issued token', () => {
    const f = fixture(); f.setup(); const plan = f.preview();
    for (const request of [undefined, { triggerUid: 'automatic' }, { token: plan.token, emails: ['faculty@school.test'] }, { token: 'fake', emails: ['faculty@school.test'], confirmed: true }]) assert.throws(() => f.context.sendApcrisReminders(request));
    assert.equal(f.state.mails.length, 0);
    f.send(plan); assert.equal(f.state.mails.length, 1);
    assert.throws(() => f.send(plan), /ถูกใช้แล้ว/);
    assert.equal(f.state.mails.length, 1);
});

test('selected recipients cannot be replaced, added or injected via client input', () => {
    const f = fixture(); f.setup(); const plan = f.preview();
    for (const email of ['intruder@school.test', 'faculty@school.test\r\nBcc: other@school.test', '']) {
        assert.throws(() => f.context.sendApcrisReminders({ token: plan.token, emails: [email], confirmed: true }));
    }
    assert.equal(f.state.mails.length, 0);
});

test('expired or evicted previews require a new review and never send', () => {
    const f = fixture(); f.setup(); const plan = f.preview();
    f.state.now += 600001;
    assert.throws(() => f.send(plan), /หมดอายุ/);
    const fresh = f.preview(); f.caches.clear();
    assert.throws(() => f.send(fresh), /หมดอายุ/);
    assert.equal(f.state.mails.length, 0);
});

test('source completion, changed recipients or a new booking invalidate the preview before any email', () => {
    for (const change of [f => { f.sheet.rows[1][7] = 'TRUE'; }, f => { f.sheet.rows[1][6] = 'changed@school.test'; }, f => { f.state.schedule[4] = ['2', '09:20-09:40', 'GE 25302', 'ภาษาอังกฤษเชิงวิชาการ', '1']; }]) {
        const f = fixture(); f.setup(); const plan = f.preview(); change(f);
        assert.throws(() => f.send(plan), /เปลี่ยนแล้ว/);
        assert.equal(f.state.mails.length, 0);
    }
});

test('quota is checked before any send and no success is recorded when quota is insufficient', () => {
    const f = fixture(); f.setup(); const plan = f.preview(); f.state.quota = 0;
    assert.throws(() => f.send(plan), /โควตา/);
    assert.equal(f.state.mails.length, 0); assert.equal(f.log().getLastRow(), 2);
});

test('the shared seven-day guard survives dialog reopening and applies across admins and terms', () => {
    const f = fixture(); f.setup(); f.send(f.preview());
    assert.equal(f.preview().groups[0].eligible, false);
    f.sheet.rows[3][6] = 'faculty@school.test';
    assert.equal(f.preview({ terms: ['1/2569'], booking: false }).groups[0].eligible, false);
    vm.runInContext("APCRIS_REMINDER_CONFIG.ADMIN_EMAILS.push('admin2@school.test')", f.context);
    f.state.actor = 'admin2@school.test';
    const held = f.preview(); assert.equal(held.groups[0].eligible, false);
    assert.throws(() => f.context.sendApcrisReminders({ token: held.token, emails: ['faculty@school.test'], confirmed: true }), /7 วัน/);
    f.state.now += 7 * 86400000 - 1;
    assert.equal(f.preview().groups[0].eligible, false);
    f.state.now++;
    assert.equal(f.preview().groups[0].eligible, true);
    f.send(f.preview()); assert.equal(f.state.mails.length, 2);
});

test('removing history rows does not erase the property-backed cooldown', () => {
    const f = fixture(); f.setup(); f.send(f.preview());
    f.log().rows.splice(2);
    assert.equal(f.preview().groups[0].eligible, false);
});

test('a second manual execution cannot send concurrently with the first', () => {
    const f = fixture(); f.setup(); const first = f.preview(); const second = f.preview();
    f.state.duringMail = () => { assert.throws(() => f.send(second), /กำลังประมวลผล/); };
    f.send(first);
    assert.equal(f.state.mails.length, 1); assert.equal(f.state.locked, false);
});

test('mail failures remain REVIEW and are not automatically retried or marked SENT', () => {
    const f = fixture(); f.setup(); f.state.failMail = true;
    const result = f.send(f.preview());
    assert.equal(result.results[0].status, 'REVIEW'); assert.equal(f.log().rows[2][5], 'REVIEW');
    f.state.now += 10 * 86400000;
    assert.equal(f.preview().groups[0].eligible, false); assert.equal(f.state.mails.length, 1);
});

test('an accepted email remains guarded even if writing the final log status fails', () => {
    const f = fixture(); f.setup(); f.log().failSent = true;
    const result = f.send(f.preview());
    assert.equal(result.results[0].status, 'SENT'); assert.equal(f.state.mails.length, 1);
    assert.equal(f.preview().groups[0].eligible, false);
    f.log().failSent = false; f.context.openApcrisReminderLog();
    assert.equal(f.log().rows[2][5], 'SENT');
    assert.equal(f.state.mails.length, 1);
});

test('only explicit administrator reconciliation releases an uncertain attempt', () => {
    const f = fixture(); f.setup(); f.state.failMail = true; f.send(f.preview());
    f.state.failMail = false; f.state.confirm = 'NO';
    f.context.resolveApcrisReminderAttempt();
    assert.equal(f.log().rows[2][5], 'NOT_SENT');
    assert.equal(f.preview().groups[0].eligible, true);
    f.send(f.preview()); assert.equal(f.state.mails.length, 2);
});

test('confirming a previously uncertain attempt as sent keeps the weekly cooldown', () => {
    const f = fixture(); f.setup(); f.state.failMail = true; f.send(f.preview());
    f.state.confirm = 'YES'; f.context.resolveApcrisReminderAttempt();
    assert.equal(f.log().rows[2][5], 'SENT');
    assert.equal(f.preview().groups[0].eligible, false);
});

test('the source tab is pinned by ID even when the active sheet becomes the reminder log', () => {
    const f = fixture(); f.setup(); f.context.openApcrisReminderLog();
    assert.equal(f.state.activeSheet, f.log());
    assert.equal(f.preview().groups.length, 1);
});

test('user-derived spreadsheet cells are neutralized instead of becoming formulas', () => {
    const f = fixture(); f.setup();
    f.sheet.rows[1][0] = '=MALICIOUS';
    const plan = f.preview({ booking: false });
    f.send(plan);
    assert.ok(f.log().rows[2][7].startsWith("'=MALICIOUS"));
    assert.equal(f.context.apcrisReminderCell_('+recipient@school.test'), "'+recipient@school.test");
});

test('malformed history fails closed and does not silently reset the cooldown', () => {
    const f = fixture(); f.setup(); f.send(f.preview());
    f.log().rows[2][5] = 'unknown-status';
    assert.throws(f.preview, /ประวัติแจ้งเตือน/);
    assert.equal(f.state.mails.length, 1);
});

test('a preview token cannot be transferred to another authorized administrator', () => {
    const f = fixture(); f.setup(); const plan = f.preview();
    vm.runInContext("APCRIS_REMINDER_CONFIG.ADMIN_EMAILS.push('admin2@school.test')", f.context);
    f.state.actor = 'admin2@school.test';
    assert.throws(() => f.send(plan), /หมดอายุ/);
    assert.equal(f.state.mails.length, 0);
});
