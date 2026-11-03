const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Report = require('../presentation-report.js');

const course = (overrides = {}) => ({ id: 'GE 25102', name: 'รายวิชาทดสอบ', instructor: 'อาจารย์ทดสอบ', termYear: '1/2569', year: 1,
    presented: false, booking: false, upload: false, upload56: false, ...overrides });
const compare = { mode: 'comparison', year: '2569' };

test('comparison uses only the selected academic year and combines term 2 and 3', () => {
    const data = [course({ presented: true }), course({ termYear: '2/2569' }), course({ termYear: '3/2569', booking: true }), course({ termYear: '1/2568' })];
    const report = Report.build(data, compare);
    assert.deepEqual(report.cohorts.map(group => [group.total, group.presented, group.rate]), [[1, 1, 100], [2, 0, 0]]);
    assert.equal(report.cohorts[1].scheduled, 1);
    assert.match(Report.summaryHtml(report), /-100\.0 จุดเปอร์เซ็นต์/);
});

test('a single-term report never includes another term or counts multiple slots', () => {
    const report = Report.build([course({ booking: true, bookingSlots: [{ time: '09:00-09:20' }, { time: '10:00-10:20' }] }), course({ termYear: '2/2569' })], { mode: 'term', term: '1/2569' });
    assert.equal(report.rows.length, 1);
    assert.equal(report.cohorts[0].scheduled, 1);
    assert.equal(report.cohorts[0].presented, 0);
    assert.equal(report.filename, 'apcris-presentation-1-2569.pdf');
    assert.match(Report.rowHtml(report.rows[0]), /\(\+1 นัด\)/);
});

test('identical duplicates collapse but the same course code in two class years remains distinct', () => {
    const report = Report.build([course(), course({ id: 'ge_25102' }), course({ year: 2 })], compare);
    assert.equal(report.cohorts[0].total, 2);
    assert.deepEqual(report.levels, [1, 2]);
});

test('conflicting duplicates and ambiguous bookings are flagged instead of counted as completed', () => {
    const report = Report.build([course({ presented: true, upload: true }), course(), course({ id: 'x', presented: true, bookingSource: 'unverified' })], compare);
    assert.equal(report.cohorts[0].review, 2);
    assert.equal(report.cohorts[0].presented, 0);
    assert.equal(report.cohorts[0].upload34, 0);
});

test('missing term coverage is labelled, does not create a zero rate, and suppresses the delta', () => {
    const report = Report.build([course({ termYear: '2/2569', presented: true })], compare);
    assert.equal(report.cohorts[0].rate, null);
    assert.deepEqual(report.cohorts[1].missing, ['3/2569']);
    const html = Report.summaryHtml(report);
    assert.match(html, /ไม่มีข้อมูลเทอม 1\/2569, 3\/2569/);
    assert.doesNotMatch(html, /จุดเปอร์เซ็นต์/);
});

test('percentages are weighted by course counts rather than averaging term rates', () => {
    const report = Report.build([course(), course({ termYear: '2/2569', presented: true }), ...[1, 2, 3].map(id => course({ id, termYear: '3/2569' }))], compare);
    assert.equal(report.cohorts[1].rate, 25);
    assert.match(Report.summaryHtml(report), /1\/4 \(25\.0%\)/);
});

test('follow-up includes missing presentations and MCO 3-4 but does not infer MCO 5-6 overdue', () => {
    const report = Report.build([course({ presented: true, upload: true }), course({ id: 'x', presented: true }), course({ id: 'y', upload: true })], compare);
    assert.deepEqual(report.rows.filter(Report.needsFollowUp).map(row => row.id), ['x', 'y']);
});

test('document scope filters summaries and detail links without changing course totals', () => {
    const data = [course({ upload: true, fileLink: 'https://drive.google.com/file/d/mco34/view',
        upload56: true, fileLink56: 'https://drive.google.com/file/d/mco56/view' }), course({ id: 'x' })];
    for (const [scope, visible, hidden] of [['mco34', 'มคอ.3-4', 'มคอ.5-6'], ['mco56', 'มคอ.5-6', 'มคอ.3-4']]) {
        const report = Report.build(data, { ...compare, documentScope: scope });
        const summary = Report.summaryHtml(report);
        const rows = report.rows.map(row => Report.rowHtml(row, report.documentScope)).join('');
        assert.equal(report.rows.length, 2);
        assert.equal(report.cohorts[0].total, 2);
        assert.ok(summary.includes(visible) && !summary.includes(hidden));
        assert.ok(rows.includes(visible) && !rows.includes(hidden));
        assert.match(rows, /ยังไม่พบเอกสาร/);
        assert.match(rows, new RegExp(`/d/${scope}/view`));
        assert.match(report.filename, new RegExp(`-${scope}\\.pdf$`));
        assert.ok(report.subtitle.includes(visible));
    }
});

test('the summary highlights only visible document totals separately from presentations', () => {
    const expected = { mco34: ['3-4'], mco56: ['5-6'], all: ['3-4', '5-6'] };
    for (const [documentScope, types] of Object.entries(expected)) {
        const report = Report.build([course({ presented: true, upload: true })], { ...compare, documentScope });
        const html = Report.summaryHtml(report);
        assert.match(html, /<tr class="pr-primary-row"><th scope="row">นำเสนอแล้ว<\/th>/);
        assert.deepEqual([...html.matchAll(/<tr class="pr-document-row"><th scope="row">ส่ง มคอ\.([35]-[46]) แล้ว<\/th>/g)].map(match => match[1]), types);
    }
});

test('an explicit MCO 5-6 selection makes follow-up check that type, while all keeps the original rule', () => {
    const report = Report.build([course({ presented: true, upload: true }), course({ id: 'x', presented: true, upload56: true })], compare);
    assert.deepEqual(report.rows.filter(row => Report.needsFollowUp(row, 'all')).map(row => row.id), ['x']);
    assert.deepEqual(report.rows.filter(row => Report.needsFollowUp(row, 'mco56')).map(row => row.id), ['GE 25102']);
    assert.equal(Report.build(report.rows, { ...compare, documentScope: 'unexpected' }).documentScope, 'all');
});

const detailCourses = [
    course({ id: 'A', presented: true, upload: true, upload56: true }),
    course({ id: 'B', booking: true, upload: true }),
    course({ id: 'C', upload56: true }),
    course({ id: 'D', bookingSource: 'unverified' }),
    course({ id: 'E', presented: true, upload: true }),
    course({ id: 'F' })
];
const selectedIds = (report, options) => Report.selectRows(report, options).map(row => row.id);

test('detail filters combine presentation, document status, and follow-up without changing report totals', () => {
    const report = Report.build(detailCourses, compare);
    assert.deepEqual(selectedIds(report, { presentation: 'presented', documents: 'partial' }), ['E']);
    assert.deepEqual(selectedIds(report, { presentation: 'scheduled', documents: 'partial', followUp: true }), ['B']);
    assert.deepEqual(selectedIds(report, { presentation: 'presented', documents: 'partial', followUp: true }), []);
    assert.deepEqual(selectedIds(report, { presentation: 'unscheduled', documents: 'missing' }), ['F']);
    assert.deepEqual(selectedIds(report, { presentation: 'review' }), ['D']);
    assert.deepEqual(selectedIds(report, { documents: 'complete' }), ['A']);
    assert.equal(report.cohorts[0].total, 6);
});

test('document status only checks the selected types, including submissions without links', () => {
    for (const [scope, complete, missing] of [['mco34', ['A', 'B', 'E'], ['C', 'D', 'F']], ['mco56', ['A', 'C'], ['B', 'D', 'E', 'F']]]) {
        const report = Report.build(detailCourses, { ...compare, documentScope: scope });
        assert.deepEqual(selectedIds(report, { documents: 'complete' }), complete);
        assert.deepEqual(selectedIds(report, { documents: 'missing' }), missing);
        assert.deepEqual(selectedIds(report, { documents: 'partial' }), []);
    }
});

test('sorting puts outstanding statuses first and preserves course order within each status', () => {
    const report = Report.build(detailCourses, compare);
    assert.deepEqual(selectedIds(report, { order: 'presentation' }), ['D', 'C', 'F', 'B', 'A', 'E']);
    assert.deepEqual(selectedIds(report, { order: 'documents' }), ['D', 'F', 'B', 'C', 'E', 'A']);
    assert.deepEqual(selectedIds(report, { order: 'presentation', documents: 'partial' }), ['C', 'B', 'E']);
    assert.deepEqual(selectedIds(report), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('report HTML escapes source values and only hyperlinks valid HTTPS documents', () => {
    const report = Report.build([course({ name: '<img src=x onerror=alert(1)>', fileLink: 'javascript:alert(1)', upload: true,
        fileLink56: 'https://drive.google.com/file/d/test/view', upload56: true, bookingSlots: [{ date: '<script>', time: '09:00' }] })], compare);
    const html = Report.rowHtml(report.rows[0]);
    assert.doesNotMatch(html, /<img|<script>|javascript:/);
    assert.match(html, /ส่งแล้ว ไม่มีลิงก์/);
    assert.match(html, /href="https:\/\/drive.google.com\/file\/d\/test\/view"/);
});

test('issue counts are scoped by term and available selectors sort newest first', () => {
    const data = [course(), course({ termYear: '3/2569' }), course({ termYear: '2/2568' }), course({ termYear: '-' })];
    assert.deepEqual(Report.periods(data), { years: ['2569', '2568'], terms: ['3/2569', '1/2569', '2/2568'] });
    assert.equal(Report.build(data, compare, [{ terms: ['1/2569'] }, { terms: ['2/2568'] }]).issueCount, 1);
    assert.equal(Report.build(data, { mode: 'term', term: 'invalid' }), null);
});

test('report has an independent tab and does not add an Apps Script trigger', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /report: 'tabReport'/);
    assert.match(html, /PresentationReport\.build\(globalData/);
    assert.match(html, /AgendaExport\.createReportPdf/);
    assert.doesNotMatch(html, /ScriptApp\.newTrigger|sendApcrisReminders/);
});

test('report page pins the asset version and checks report API compatibility', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const version = html.match(/APP_VERSION = 'v([\d.]+)'/)[1];
    assert.ok(html.includes(`src="presentation-report.js?v=${version}"`));
    assert.equal(Report.reportApiVersion, 2);
    assert.match(html, /window\.PresentationReport\?\.reportApiVersion !== 2/);
});
