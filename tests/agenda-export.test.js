const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { rowHtml, filename, safeUrl } = require('../agenda-export.js');

const entry = overrides => ({
    row: 5, code: '202300319', name: 'การวิจัยด้านสาธารณสุข 2', level: '3',
    instructor: 'อาจารย์ทดสอบ', time: '09:00–09:20',
    course: { id: '202300319', name: 'การวิจัยด้านสาธารณสุข 2 (Research in Public Health II)', year: 3, termYear: '2/2569', presented: false },
    ...overrides
});

test('PDF rows retain course identity, schedule, instructor and status', () => {
    const html = rowHtml(entry(), 'pdf', false);
    for (const value of ['202300319', 'ชั้นปี 3', '2/2569', 'Research in Public Health II', 'อาจารย์ทดสอบ', '09:00-09:20', 'รอนำเสนอ']) assert.ok(html.includes(value));
    assert.equal((html.match(/<td/g) || []).length, 4);
});

test('social images use a readable two-column layout and preserve content', () => {
    const html = rowHtml(entry(), 'image', false);
    assert.equal((html.match(/<td/g) || []).length, 2);
    assert.match(html, /อาจารย์ทดสอบ/);
    assert.match(html, /Research in Public Health II/);
});

test('unmatched entries remain visible with their specific issue', () => {
    const html = rowHtml(entry({ course: null, issue: 'ไม่พบรหัสวิชา' }), 'pdf', false);
    assert.match(html, /การวิจัยด้านสาธารณสุข 2/);
    assert.match(html, /ตรวจสอบรายวิชา/);
    assert.match(html, /ไม่พบรหัสวิชา/);
});

test('exported rows escape source text and do not emit executable URLs', () => {
    const html = rowHtml(entry({ instructor: '<img src=x onerror="alert(1)">', course: { name: '<script>alert(1)</script>', fileLink: 'javascript:alert(1)', fileLink56: 'https://drive.google.com/file/d/abc/view' } }), 'pdf', false);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('href="javascript:'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('href="https://drive.google.com/file/d/abc/view"'));
});

test('image names remain safe and distinguish continuation pages', () => {
    assert.equal(filename('2026-11-02', 'image'), 'course-review-agenda-2026-11-02.png');
    assert.equal(filename('2026-11-02', 'image', 2, 3), 'course-review-agenda-2026-11-02-p2.png');
    assert.equal(filename('../../etc', 'pdf'), 'course-review-agenda-meeting.pdf');
});

test('export rejects non-HTTPS URLs and authentication embedded in URLs', () => {
    assert.equal(safeUrl('data:text/html,hello'), '');
    assert.equal(safeUrl('https://user:password@example.test'), '');
    assert.equal(safeUrl('https://teams.microsoft.com/meet/123'), 'https://teams.microsoft.com/meet/123');
});

test('the release and footer badge use one updated version and the current release date', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /APP_VERSION = 'v1\.2\.0'/);
    assert.match(html, /APP_RELEASE_DATE = '30 ตุลาคม 2569'/);
    assert.match(html, /getElementById\('footerVersion'\)\.innerText = APP_VERSION/);
});
