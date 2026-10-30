(function (root) {
    'use strict';

    function text(value) {
        return String(value == null ? '' : value).normalize('NFKC').trim()
            .replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
    }

    function normalizeCode(value) {
        return text(value).toUpperCase().replace(/[\s_\-/]/g, '');
    }

    function normalizeName(value) {
        const name = text(value).replace(/\([^)]*(?:\)|$)/g, '')
            .toLowerCase().replace(/[\s\u200b-\u200d\ufeff.\-_/]/g, '');
        // Verified spelling difference between the two existing spreadsheets.
        return name === 'ความร่วมมือสหวิชาชีพ' ? 'ความร่วมมือแบบสหวิชาชีพ' : name;
    }

    function number(value) {
        const match = text(value).match(/\d+/);
        return match ? String(Number(match[0])) : '';
    }

    function scopeFromTitle(value) {
        const match = text(value).match(/([1-3](?:\s*[-–,]\s*[1-3])*)\s*\/\s*((?:25|20)\d{2})/);
        if (!match) return [];
        let terms = match[1].match(/[1-3]/g);
        if (/[-–]/.test(match[1]) && terms.length === 2) {
            terms = Array.from({ length: Number(terms[1]) - Number(terms[0]) + 1 }, (_, i) => String(Number(terms[0]) + i));
        }
        const year = Number(match[2]) < 2400 ? Number(match[2]) + 543 : Number(match[2]);
        return terms.map(term => `${term}/${year}`);
    }

    function column(row, names) {
        const normalizedNames = names.map(name => text(name).replace(/\s+/g, ''));
        return row.findIndex(value => normalizedNames.includes(text(value).replace(/\s+/g, '')));
    }

    function readSchedule(rows) {
        let columns = null;
        let scope = [];
        let date = '';
        let headerCount = 0;
        let timeSlotCount = 0;
        const records = [];
        const coveredTerms = new Set();

        rows.forEach((row, index) => {
            const courseColumn = column(row, ['รายวิชา', 'ชื่อรายวิชา']);
            const timeColumn = column(row, ['เวลา', 'เวลานำเสนอ']);
            if (courseColumn >= 0 && timeColumn >= 0) {
                const previousColumns = columns;
                columns = {
                    name: courseColumn, time: timeColumn,
                    code: column(row, ['รหัสวิชา', 'รหัส', 'CourseCode', 'course_code']),
                    level: column(row, ['ชั้นปี']),
                    term: column(row, ['ภาคการศึกษา', 'เทอม']),
                    year: column(row, ['ปีการศึกษา']),
                    presented: column(row, ['นำเสนอ', 'การนำเสนอ', 'นำเสนอแล้ว'])
                };
                // Repeated day headers may leave shared column labels blank.
                if (previousColumns && previousColumns.name === columns.name && previousColumns.time === columns.time) {
                    ['code', 'level', 'term', 'year', 'presented'].forEach(key => {
                        const previousIndex = previousColumns[key];
                        if (columns[key] < 0 && previousIndex >= 0 && text(row[previousIndex]) === '') {
                            columns[key] = previousIndex;
                        }
                    });
                }
                headerCount += 1;
                return;
            }

            const titleScope = scopeFromTitle(row[0]);
            if (titleScope.length && !/^\d+$/.test(text(row[0]))) {
                scope = titleScope;
                scope.forEach(term => coveredTerms.add(term));
                date = '';
                return;
            }
            if (/^วัน/.test(text(row[0]))) {
                date = text(row[0]);
                return;
            }
            if (!columns) return;
            const time = text(row[columns.time]);
            if (!/^\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}$/.test(time)) return;
            timeSlotCount += 1;

            let terms = scope;
            const term = number(row[columns.term]);
            const year = number(row[columns.year]);
            if (term && year) terms = [`${term}/${Number(year) < 2400 ? Number(year) + 543 : year}`];
            terms.forEach(value => coveredTerms.add(value));
            let name = text(row[columns.name]);
            let code = text(row[columns.code]);
            if (!name && !code) return;
            if (/^(พัก|พักเที่ยง|ว่าง|จอง|ยกเลิก)$/.test(name)) return;
            if (!code) {
                const prefix = name.match(/^([A-Za-z]+\s*\d+(?:\s*\(SEC\s*\d+\))?|\d{6,12})(?:\s+|[_:])(.+)$/i);
                if (prefix) { code = prefix[1]; name = prefix[2]; }
            }
            const presentedText = text(row[columns.presented]).toUpperCase();
            const trueValues = ['TRUE', text('นำเสนอแล้ว')];
            const falseValues = ['FALSE', text('ยังไม่นำเสนอ')];
            const presented = [...trueValues, ...falseValues].includes(presentedText) ? trueValues.includes(presentedText) : null;
            records.push({ code, name, level: number(row[columns.level]), terms: [...terms], date, time, presented, row: index + 1 });
        });

        if (!headerCount) throw new Error('ไม่พบหัวคอลัมน์ เวลา และ รายวิชา ในชีตลงเวลา');
        if (!timeSlotCount) throw new Error('ไม่พบช่องเวลานัดในตารางลงเวลา');
        if (!coveredTerms.size) throw new Error('ไม่พบภาคการศึกษาในชีตลงเวลา เช่น 2-3/2569');
        if (records.some(record => !record.terms.length)) throw new Error('มีรายการลงเวลาที่ไม่ระบุภาคการศึกษา');
        return { records, coveredTerms: [...coveredTerms] };
    }

    function merge(courses, schedule) {
        const matches = new Map();
        const uncertain = new Set();
        const issues = [];
        let matchedCount = 0;

        schedule.records.forEach(record => {
            let candidates = courses.map((course, index) => ({ course, index }))
                .filter(({ course }) => record.terms.includes(course.termYear))
                .filter(({ course }) => !record.level || String(course.year) === record.level);
            if (record.code) {
                // A supplied code is authoritative; never silently fall back to another course name.
                candidates = candidates.filter(({ course }) => normalizeCode(course.id) === normalizeCode(record.code));
            } else {
                candidates = candidates.filter(({ course }) => normalizeName(course.name) === normalizeName(record.name));
            }
            if (candidates.length !== 1) {
                candidates.forEach(({ index }) => uncertain.add(index));
                issues.push({ ...record, reason: candidates.length ? 'พบหลายรายวิชา กรุณาระบุรหัสวิชา/ชั้นปี' : 'ไม่พบรายวิชาในชีตสรุปของเทอมนี้' });
                return;
            }
            const index = candidates[0].index;
            if (!matches.has(index)) matches.set(index, []);
            matches.get(index).push(record);
            matchedCount += 1;
        });

        const data = courses.map((course, index) => {
            if (!schedule.coveredTerms.includes(course.termYear)) return { ...course, bookingSource: 'summary', bookingSlots: [] };
            const slots = matches.get(index) || [];
            if (uncertain.has(index) && !slots.length) return { ...course, bookingSource: 'unverified', bookingSlots: [] };
            const reportedPresentations = slots.filter(slot => slot.presented !== null);
            const presented = reportedPresentations.length ? reportedPresentations.some(slot => slot.presented) : course.presented;
            return { ...course, booking: slots.length > 0, presented, bookingSource: 'schedule', bookingSlots: slots };
        });
        return { data, issues, matchedCount, totalCount: schedule.records.length, coveredTerms: schedule.coveredTerms };
    }

    const api = { readSchedule, merge, normalizeCode, normalizeName };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BookingSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
