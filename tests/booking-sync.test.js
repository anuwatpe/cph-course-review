const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSchedule, merge } = require('../booking-sync.js');

const header = ['ลำดับ', 'เวลา', 'รายวิชา', 'ชั้นปี', 'รหัสวิชา', 'นำเสนอ'];
const course = (overrides = {}) => ({
    id: '202300319', name: 'การวิจัยด้านสาธารณสุข 2 (Research in Public Health II)',
    year: 3, termYear: '2/2569', booking: false, presented: false, ...overrides
});
const schedule = (rows, title = 'ตารางเวลานำเสนอ 2-3/2569') => readSchedule([[title], header, ...rows]);

test('reads repeated daily headers, empty slots and breaks with correct day', () => {
    const parsed = readSchedule([
        ['ตารางเวลานำเสนอ 2-3/2569'], ['วันจันทร์ ที่ 2 พฤศจิกายน 2569'], header,
        ['1', '09:00–09:20', 'การวิจัยด้านสาธารณสุข 2', '3'],
        ['2', '09:20–09:40', '', ''], ['', '10:20–10:30', 'พัก'],
        ['วันอังคาร ที่ 3 พฤศจิกายน 2569'], ['ลำดับ', 'เวลา', 'รายวิชา', ''],
        ['3', '09:00–09:20', 'อีกวิชา', '1']
    ]);
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.records[1].level, '1');
    assert.match(parsed.records[1].date, /วันอังคาร/);
    assert.deepEqual(parsed.coveredTerms, ['2/2569', '3/2569']);
});

test('matches Thai name despite English suffix, preserves other terms', () => {
    const result = merge([course(), course({ termYear: '1/2569', booking: true })], schedule([
        ['1', '09:00–09:20', 'การวิจัยด้านสาธารณสุข 2', '3']
    ]));
    assert.equal(result.matchedCount, 1);
    assert.equal(result.data[0].booking, true);
    assert.equal(result.data[1].booking, true);
    assert.equal(result.data[1].bookingSource, 'summary');
});

test('reads explicit code column and code prefixed to a course name', () => {
    const courses = [course({ id: 'GE 25302', name: 'ภาษาอังกฤษเชิงวิชาการ', year: 1 })];
    for (const row of [
        ['1', '09:00–09:20', 'ชื่อที่สะกดต่าง', '1', 'GE25302'],
        ['1', '09:00–09:20', 'GE 25302 ภาษาอังกฤษเชิงวิชาการ', '1']
    ]) assert.equal(merge(courses, schedule([row])).data[0].booking, true);
});

test('inherits blank code and level labels in a repeated day header', () => {
    const parsed = readSchedule([
        ['ตารางเวลานำเสนอ 2-3/2569'],
        ['ลำดับ', 'เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี'],
        ['1', '09:00–09:20', '202300319', 'การวิจัยด้านสาธารณสุข 2', '3'],
        ['วันอังคาร ที่ 3 พฤศจิกายน 2569'],
        ['ลำดับ', 'เวลา', '', 'รายวิชา', ''],
        ['2', '09:20–09:40', 'GE 25302 ', 'ชื่อที่สะกดต่างจากชีตสรุป', '1']
    ]);
    assert.equal(parsed.records[1].code, 'GE 25302');
    assert.equal(parsed.records[1].level, '1');
    assert.equal(merge([course(), course({ id: 'GE 25302', name: 'ภาษาอังกฤษเชิงวิชาการ', year: 1 })], parsed).matchedCount, 2);
});

test('does not inherit column positions when a repeated header changes layout', () => {
    const parsed = readSchedule([
        ['ตารางเวลานำเสนอ 2-3/2569'],
        ['ลำดับ', 'เวลา', 'รหัสวิชา', 'รายวิชา', 'ชั้นปี'],
        ['1', '09:00–09:20', '202300319', 'การวิจัยด้านสาธารณสุข 2', '3'],
        ['ลำดับ', 'เวลา', 'รายวิชา', 'ผู้รับผิดชอบ', ''],
        ['2', '09:20–09:40', 'ภาษาอังกฤษเชิงวิชาการ', 'อาจารย์ทดสอบ', '']
    ]);
    assert.equal(parsed.records[1].code, '');
    assert.equal(parsed.records[1].level, '');
});

test('incorrect explicit code never falls back to a similar name', () => {
    const result = merge([course()], schedule([['1', '09:00–09:20', 'การวิจัยด้านสาธารณสุข 2', '3', '999999999']]));
    assert.equal(result.matchedCount, 0);
    assert.equal(result.issues.length, 1);
});

test('removing a reservation clears its status even if summary still says TRUE', () => {
    const result = merge([course({ booking: true })], schedule([['1', '09:00–09:20', '', '3']]));
    assert.equal(result.data[0].booking, false);
});

test('duplicate codes in different levels are disambiguated by class year', () => {
    const result = merge([course(), course({ year: 4 })], schedule([['1', '09:00–09:20', '', '4', '202300319']]));
    assert.deepEqual(result.data.map(item => item.booking), [false, true]);
});

test('ambiguous matches are reported and keep the prior summary status', () => {
    const result = merge([course({ booking: true }), course({ year: 4 })], schedule([['1', '09:00–09:20', '', '', '202300319']]));
    assert.equal(result.matchedCount, 0);
    assert.equal(result.issues.length, 1);
    assert.deepEqual(result.data.map(item => item.bookingSource), ['unverified', 'unverified']);
    assert.equal(result.data[0].booking, true);
});

test('recognizes the verified interprofessional course name alias', () => {
    const result = merge([course({ id: 'GE 25102', name: 'ความร่วมมือแบบสหวิชาชีพ (Interprofessional Collaboration)', year: 1 })],
        schedule([['1', '09:00–09:20', 'ความร่วมมือสหวิชาชีพ', '1']]));
    assert.equal(result.matchedCount, 1);
});

test('does not infer presentation from a booking; optional checkbox controls it', () => {
    for (const [value, expected] of [['', false], ['TRUE', true], ['FALSE', false], ['นำเสนอแล้ว', true], ['ยังไม่นำเสนอ', false]]) {
        const result = merge([course()], schedule([['1', '09:00–09:20', '', '3', '202300319', value]]));
        assert.equal(result.data[0].presented, expected);
    }
    const result = merge([course({ presented: true })], schedule([['1', '09:00–09:20', '', '3', '202300319', '']]));
    assert.equal(result.data[0].presented, true);
});

test('requires a recognizable header and semester scope', () => {
    assert.throws(() => readSchedule([['Please sign in']]));
    assert.throws(() => readSchedule([['กำหนดการ 2/2569'], header]));
    assert.throws(() => readSchedule([header, ['1', '09:00–09:20', 'วิชา']]));
});

test('supports an explicit term and academic-year column without a title', () => {
    const parsed = readSchedule([
        [...header, 'ภาคการศึกษา', 'ปีการศึกษา'],
        ['1', '09:00–09:20', '', '3', '202300319', '', '2', '2026']
    ]);
    assert.deepEqual(parsed.coveredTerms, ['2/2569']);
    assert.equal(merge([course()], parsed).matchedCount, 1);
});
