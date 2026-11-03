(function (root) {
    'use strict';

    const title = 'รายงานผลการนำเสนอรายวิชา';
    const statuses = { presented: 'นำเสนอแล้ว', scheduled: 'นัดแล้ว รอนำเสนอ', unscheduled: 'ยังไม่พบการลงเวลา', review: 'ตรวจสอบข้อมูล' };
    const metrics = [
        ['total', 'รายวิชาทั้งหมด'], ['presented', 'นำเสนอแล้ว'], ['scheduled', statuses.scheduled],
        ['unscheduled', statuses.unscheduled], ['review', statuses.review], ['upload34', 'ส่ง มคอ.3-4 แล้ว'], ['upload56', 'ส่ง มคอ.5-6 แล้ว']
    ];

    function escape(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function safeUrl(value) {
        try { const url = new URL(String(value ?? '').trim()); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
        catch (_) { return ''; }
    }

    function periods(courses) {
        const terms = [...new Set(courses.map(course => course.termYear).filter(term => /^[123]\/\d{4}$/.test(term)))];
        terms.sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)) || Number(b[0]) - Number(a[0]));
        return { terms, years: [...new Set(terms.map(term => term.slice(2)))] };
    }

    function status(course) {
        return course.bookingSource === 'unverified' ? 'review' : course.presented ? 'presented' : course.booking ? 'scheduled' : 'unscheduled';
    }

    function counts(rows) {
        const result = { total: rows.length, presented: 0, scheduled: 0, unscheduled: 0, review: 0, upload34: 0, upload56: 0 };
        for (const row of rows) {
            result[row.status]++;
            if (row.upload) result.upload34++;
            if (row.upload56) result.upload56++;
        }
        return { ...result, rate: rows.length ? result.presented / rows.length * 100 : null };
    }

    function build(courses, selection, issues = []) {
        const comparison = selection.mode === 'comparison';
        const year = comparison ? String(selection.year) : String(selection.term).slice(2);
        if (!/^\d{4}$/.test(year) || (!comparison && !/^[123]\/\d{4}$/.test(selection.term))) return null;
        const scopes = comparison ? [[`1/${year}`], [`2/${year}`, `3/${year}`]] : [[selection.term]];
        const keys = new Map();
        const termSet = new Set(scopes.flat());
        for (const course of courses) {
            if (!termSet.has(course.termYear)) continue;
            const code = String(course.id || '').normalize('NFKC').toUpperCase().replace(/[\s_\-/]/g, '');
            if (!code) continue;
            const level = Number(course.year) > 0 ? Number(course.year) : 0;
            const key = JSON.stringify([course.termYear, code, level]);
            const row = { ...course, level, status: status(course), upload: Boolean(course.upload), upload56: Boolean(course.upload56) };
            const previous = keys.get(key);
            if (!previous) keys.set(key, row);
            else if (['status', 'name', 'instructor', 'upload', 'upload56', 'fileLink', 'fileLink56'].some(field => previous[field] !== row[field])) {
                keys.set(key, { ...previous, status: 'review', upload: previous.upload && row.upload && previous.fileLink === row.fileLink,
                    upload56: previous.upload56 && row.upload56 && previous.fileLink56 === row.fileLink56,
                    fileLink: previous.fileLink === row.fileLink ? row.fileLink : '', fileLink56: previous.fileLink56 === row.fileLink56 ? row.fileLink56 : '' });
            }
        }
        const rows = [...keys.values()].sort((a, b) => a.termYear.localeCompare(b.termYear) || a.level - b.level || String(a.id).localeCompare(String(b.id), 'th', { numeric: true }));
        const cohorts = scopes.map((terms, index) => {
            const group = rows.filter(row => terms.includes(row.termYear));
            const available = terms.filter(term => group.some(row => row.termYear === term));
            return { label: comparison ? (index ? 'เทอม 2+3' : 'เทอม 1') : `เทอม ${selection.term}`,
                terms, available, missing: terms.filter(term => !available.includes(term)), rows: group, ...counts(group) };
        });
        const levels = [...new Set(rows.map(row => row.level))].sort((a, b) => (a || Infinity) - (b || Infinity));
        return { rows, cohorts, levels, year, comparison, title,
            subtitle: comparison ? `เปรียบเทียบเทอม 1 กับเทอม 2+3 / ปีการศึกษา ${year}` : `ภาคการศึกษา ${selection.term}`,
            filename: comparison ? `apcris-presentation-${year}-term-1-vs-2-3.pdf` : `apcris-presentation-${selection.term.replace('/', '-')}.pdf`,
            issueCount: issues.filter(issue => issue.terms?.some(term => termSet.has(term))).length };
    }

    function percent(value) { return value === null ? 'ไม่มีข้อมูล' : `${value.toFixed(1)}%`; }
    function ratio(value, total) { return total ? `${value}/${total} (${percent(value / total * 100)})` : 'ไม่มีข้อมูล'; }

    function summaryHtml(report) {
        const heads = report.cohorts.map((cohort, index) => `<th scope="col" class="pr-series-${index}">${escape(cohort.label)}<small>${cohort.available.length ? `ข้อมูล ${escape(cohort.available.join(', '))}` : 'ไม่มีข้อมูล'}</small></th>`).join('');
        const totals = metrics.map(([key, label]) => `<tr${key === 'presented' ? ' class="pr-primary-row"' : ''}><th scope="row">${label}</th>${report.cohorts.map(cohort => `<td>${!cohort.total ? '-' : ['presented', 'upload34', 'upload56'].includes(key) ? ratio(cohort[key], cohort.total) : cohort[key]}</td>`).join('')}</tr>`).join('');
        const chart = report.levels.map(level => `<div class="pr-level"><strong>${level ? `ชั้นปี ${level}` : 'ไม่ระบุชั้นปี'}</strong>${report.cohorts.map((cohort, index) => {
            const bucket = counts(cohort.rows.filter(row => row.level === level));
            return `<div class="pr-chart-row pr-series-${index}"><span>${escape(cohort.label)}</span><span class="pr-track" aria-hidden="true"><span style="width:${bucket.rate ?? 0}%"></span></span><span>${ratio(bucket.presented, bucket.total)}</span></div>`;
        }).join('')}</div>`).join('');
        const missing = report.cohorts.flatMap(cohort => cohort.missing);
        const delta = report.comparison && !missing.length ? report.cohorts[1].rate - report.cohorts[0].rate : null;
        return `<div class="pr-overview"><div><h3>สรุปสถานะรายวิชา</h3><table class="pr-table pr-summary" aria-label="สรุปสถานะรายวิชาตามเทอม"><thead><tr><th scope="col">รายการ</th>${heads}</tr></thead><tbody>${totals}</tbody></table>
            ${delta === null ? '' : `<p class="pr-note">อัตรานำเสนอ เทอม 2+3 เทียบเทอม 1: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} จุดเปอร์เซ็นต์</p>`}
            ${missing.length ? `<p class="pr-alert">ยังไม่มีข้อมูลเทอม ${escape(missing.join(', '))}</p>` : ''}
            ${report.issueCount ? `<p class="pr-alert">มีรายการลงเวลาที่จับคู่ไม่ได้ ${report.issueCount} รายการ สถานะบางวิชาอาจยังไม่ครบ</p>` : ''}</div>
            <div><h3>นำเสนอแล้วแยกชั้นปี</h3>${chart || '<p class="pr-note">ไม่มีข้อมูล</p>'}<p class="pr-note">ร้อยละคำนวณจากรายวิชาทั้งหมดในกลุ่มตามสถานะที่บันทึก เป็นข้อมูล ณ วันที่อ่าน ไม่ใช่ผลสิ้นเทอม</p></div></div>`;
    }

    const tableHead = '<colgroup><col style="width:40%"><col style="width:23%"><col style="width:19%"><col style="width:18%"></colgroup><thead><tr><th scope="col">รายวิชา</th><th scope="col">ผู้รับผิดชอบ / เวลานัด</th><th scope="col">นำเสนอ</th><th scope="col">เอกสาร</th></tr></thead>';

    function rowHtml(row) {
        const slots = row.bookingSlots || [];
        const schedule = slots.length ? `${escape(slots[0].date)} ${escape(slots[0].time)}${slots.length > 1 ? ` (+${slots.length - 1} นัด)` : ''}` : '-';
        const document = (label, uploaded, link) => {
            const url = safeUrl(link);
            return `<div>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label}<small>${uploaded ? (url ? 'ส่งแล้ว' : 'ส่งแล้ว ไม่มีลิงก์') : 'ยังไม่พบเอกสาร'}</small></div>`;
        };
        return `<tr data-report-row><td><strong>${escape(row.name)}</strong><small>${escape(row.id)} / ${row.level ? `ชั้นปี ${row.level}` : 'ไม่ระบุชั้นปี'} / ${escape(row.termYear)}</small></td>
            <td>${escape(row.instructor || '-')}<small>${schedule}</small></td><td><span class="pr-status-${row.status}">${statuses[row.status]}</span></td>
            <td class="pr-docs">${document('มคอ.3-4', row.upload, row.fileLink)}${document('มคอ.5-6', row.upload56, row.fileLink56)}</td></tr>`;
    }

    function needsFollowUp(row) { return row.status !== 'presented' || !row.upload; }

    const api = { periods, build, summaryHtml, tableHead, rowHtml, needsFollowUp };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PresentationReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
