(function (root) {
    'use strict';

    const libraries = new Map();
    const SOURCES = {
        canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        pdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
        qr: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'
    };
    const STYLE = `
        .ae-page,.ae-page *{box-sizing:border-box;letter-spacing:0}
        .ae-page{width:794px;height:1123px;padding:40px 42px 30px;background:#fff;color:#1e293b;font-family:Prompt,Tahoma,sans-serif;font-size:14px;line-height:1.6;display:flex;flex-direction:column;overflow:hidden}
        .ae-brand{font-size:13px;color:#475569;margin:0 0 6px}
        .ae-title{font-size:25px;line-height:1.4;font-weight:600;margin:0 0 8px;color:#172d50}
        .ae-term{font-size:13px;color:#475569;margin:0}
        .ae-header{border-top:5px solid #2563eb;padding-top:18px;padding-bottom:16px;border-bottom:1px solid #cbd5e1;flex-shrink:0}
        .ae-day{display:table;width:100%;padding:18px 0;flex-shrink:0}
        .ae-date{display:table-cell;vertical-align:middle;padding-right:16px}
        .ae-date h2{font-size:18px;line-height:1.5;font-weight:600;margin:0 0 4px}
        .ae-date p{font-size:12px;color:#64748b;margin:0}
        .ae-qr{display:table-cell;text-align:center;vertical-align:middle;width:106px;font-size:10px;color:#1d4ed8;text-decoration:none}
        .ae-qr img{display:block;width:92px;height:92px;margin:0 auto 3px;image-rendering:pixelated}
        .ae-filters{font-size:11px;line-height:1.6;padding:8px 10px;background:#f1f5f9;color:#475569;margin:0 0 12px;flex-shrink:0}
        .ae-content{flex:1;min-height:0;overflow:hidden}
        .ae-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}
        .ae-table th{background:#eaf0f8;color:#334155;padding:9px 8px;text-align:left;font-size:11px;font-weight:500;border-bottom:1px solid #cbd5e1}
        .ae-table td{padding:12px 8px;vertical-align:top;border-bottom:1px solid #e2e8f0;overflow-wrap:break-word}
        .ae-time{white-space:nowrap;color:#1d4ed8;font-weight:500}
        .ae-name{font-weight:500;line-height:1.65;margin:0 0 4px}
        .ae-meta{font-size:10px;color:#64748b;line-height:1.6}
        .ae-status{font-size:10px;color:#475569}
        .ae-issue{color:#9a3412;font-size:10px;margin-top:5px}
        .ae-links{font-size:10px;margin-top:5px}
        .ae-links a{color:#1d4ed8;text-decoration:underline;margin-right:10px}
        .ae-owner{font-size:12px;line-height:1.7}
        .ae-footer{border-top:1px solid #cbd5e1;padding-top:10px;margin-top:14px;color:#64748b;font-size:9px;flex-shrink:0}
        .ae-footer-top{display:table;width:100%}
        .ae-footer-left,.ae-page-number{display:table-cell;vertical-align:top}
        .ae-page-number{text-align:right;white-space:nowrap;padding-left:12px}
        .ae-stale{color:#9a3412;font-size:10px;margin-top:4px}
        .ae-image{width:1080px;height:1528px;padding:52px 56px 38px;font-size:24px}
        .ae-image .ae-brand{font-size:22px;margin-bottom:10px}
        .ae-image .ae-title{font-size:36px;margin-bottom:14px}
        .ae-image .ae-term{font-size:21px}
        .ae-image .ae-header{border-top-width:7px;padding-top:24px;padding-bottom:24px}
        .ae-image .ae-day{padding:24px 0}
        .ae-image .ae-date h2{font-size:29px}
        .ae-image .ae-date p{font-size:20px}
        .ae-image .ae-qr{width:180px;font-size:17px}
        .ae-image .ae-qr img{width:164px;height:164px}
        .ae-image .ae-filters{font-size:18px;padding:10px 14px;margin-bottom:16px}
        .ae-image .ae-table th{font-size:19px;padding:12px}
        .ae-image .ae-table td{padding:19px 12px}
        .ae-image .ae-time{font-size:23px}
        .ae-image .ae-name{font-size:25px;line-height:1.6;margin-bottom:6px}
        .ae-image .ae-meta{font-size:19px}
        .ae-image .ae-owner{font-size:22px;line-height:1.6;margin-top:7px}
        .ae-image .ae-status,.ae-image .ae-issue{font-size:18px;margin-top:5px}
        .ae-image .ae-footer{font-size:15px;padding-top:14px;margin-top:20px}
        .ae-image .ae-stale{font-size:16px}
        .ae-room{margin-top:8px;font-size:16px;color:#475569}
        .ae-room img{width:100px;height:100px;display:inline-block;vertical-align:middle;margin-right:12px;image-rendering:pixelated}
    `;

    function escape(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function safeUrl(value) {
        try { const url = new URL(String(value || '').trim()); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
        catch (_) { return ''; }
    }

    function status(entry) {
        if (entry.issue) return 'ตรวจสอบรายวิชา';
        return (entry.course ? entry.course.presented : entry.presented) ? 'นำเสนอแล้ว' : 'รอนำเสนอ';
    }

    function rowHtml(entry, kind, separateMeeting, qrImages = new Map()) {
        const course = entry.course || {};
        const name = course.name || entry.name || 'ยังไม่ระบุชื่อรายวิชา';
        const meta = `${course.id || entry.code || '-'} / ชั้นปี ${course.year || entry.level || '-'}${course.termYear ? ` / ${course.termYear}` : ''}`;
        const owner = entry.instructor || course.instructor || 'ยังไม่ระบุผู้รับผิดชอบ';
        const links = [{ label: 'มคอ.3-4', url: course.fileLink }, { label: 'มคอ.5-6', url: course.fileLink56 }];
        if (separateMeeting) links.push({ label: 'Teams', url: entry.meetingUrl });
        const documents = links.filter(link => safeUrl(link.url)).map(link => `<a href="${escape(safeUrl(link.url))}">${link.label}</a>`).join('');
        const issue = entry.issue ? `<div class="ae-issue">${escape(entry.issue)}</div>` : '';
        const details = `<div class="ae-name">${escape(name)}</div><div class="ae-meta">${escape(meta)}</div>`;
        const time = escape(String(entry.time).replace(/[–—]/g, '-'));
        const roomQr = kind === 'image' && separateMeeting && qrImages.has(safeUrl(entry.meetingUrl))
            ? `<div class="ae-room"><img src="${qrImages.get(safeUrl(entry.meetingUrl))}" alt="QR Code ห้องประชุม">Teams</div>` : '';
        return `<tr data-export-row="${Number(entry.row) || 0}"><td class="ae-time">${time}</td><td>${details}${kind === 'image' ? `<div class="ae-owner">${escape(owner)}</div><div class="ae-status">${status(entry)}</div>${roomQr}` : `<div class="ae-links">${documents}</div>`}${issue}</td>${kind === 'image' ? '' : `<td class="ae-owner">${escape(owner)}</td><td class="ae-status">${status(entry)}</td>`}</tr>`;
    }

    function filename(dayKey, kind, page = 1, pageCount = 1) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : 'meeting';
        return `course-review-agenda-${date}${pageCount > 1 ? `-p${page}` : ''}.${kind === 'image' ? 'png' : 'pdf'}`;
    }

    function loadLibrary(key, available) {
        if (available()) return Promise.resolve();
        if (!libraries.has(key)) libraries.set(key, new Promise((resolve, reject) => {
            const script = root.document.createElement('script');
            const timer = root.setTimeout(() => fail(), 25000);
            const fail = () => { root.clearTimeout(timer); script.remove(); libraries.delete(key); reject(new Error('โหลดเครื่องมือส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง')); };
            script.src = SOURCES[key]; script.async = true;
            script.onload = () => { if (available()) { root.clearTimeout(timer); resolve(); } else fail(); };
            script.onerror = fail;
            root.document.head.appendChild(script);
        }));
        return libraries.get(key);
    }

    function abortIfNeeded(signal) {
        if (signal?.aborted) throw new DOMException('ยกเลิกการส่งออก', 'AbortError');
    }

    function pageHtml(snapshot, day, kind, continuation, qrImages) {
        const urls = [...new Set(day.entries.map(entry => safeUrl(entry.meetingUrl)).filter(Boolean))];
        const qr = urls.length === 1 ? `<a class="ae-qr" href="${escape(urls[0])}"><img src="${qrImages.get(urls[0])}" alt="QR Code เข้าประชุม Teams"><span>เข้าประชุม Teams</span></a>` : '';
        const subtitle = urls.length > 1 ? 'ลิงก์ประชุมแยกตามรายวิชา' : urls.length ? 'Microsoft Teams' : 'ยังไม่มีลิงก์ประชุม';
        return `<section class="ae-page ${kind === 'image' ? 'ae-image' : ''}" data-export-day="${escape(day.key)}">
            <header class="ae-header"><p class="ae-brand">สาขาวิชาสาธารณสุขชุมชน</p><h1 class="ae-title">กำหนดการประชุมวิพากษ์รายวิชา</h1><p class="ae-term">ภาคการศึกษา ${escape(snapshot.terms.join(', '))}</p></header>
            <div class="ae-day"><div class="ae-date"><h2>${escape(day.label)}${continuation ? ' (ต่อ)' : ''}</h2><p>${day.entries.length} รายวิชา / ${subtitle}</p></div>${qr}</div>
            ${snapshot.filters ? `<div class="ae-filters">ตัวกรอง: ${escape(snapshot.filters)}</div>` : ''}
            <div class="ae-content"><table class="ae-table">${kind === 'image' ? '<colgroup><col style="width:19%"><col style="width:81%"></colgroup><thead><tr><th>เวลา</th><th>รายวิชา / ผู้รับผิดชอบ</th></tr></thead>' : '<colgroup><col style="width:17%"><col style="width:43%"><col style="width:26%"><col style="width:14%"></colgroup><thead><tr><th>เวลา</th><th>รายวิชา / ชั้นปี</th><th>ผู้รับผิดชอบ</th><th>สถานะ</th></tr></thead>'}<tbody></tbody></table></div>
            <footer class="ae-footer"><div class="ae-footer-top"><span class="ae-footer-left">ข้อมูลลงเวลา ${escape(snapshot.updatedAt || '-')}<br>จัดทำ ${escape(snapshot.createdAt)} / ${escape(snapshot.version)}</span><span class="ae-page-number"></span></div>${snapshot.stale ? '<div class="ae-stale">ใช้ข้อมูลที่อ่านได้ล่าสุด เนื่องจากยังอัปเดตข้อมูลลงเวลาไม่ได้</div>' : ''}</footer>
        </section>`;
    }

    async function layout(snapshot, kind, signal) {
        await Promise.all([
            loadLibrary('canvas', () => typeof root.html2canvas === 'function'),
            loadLibrary('qr', () => typeof root.qrcode === 'function'),
            root.document.fonts.ready
        ]);
        abortIfNeeded(signal);
        if (!snapshot.groups?.length) throw new Error('ไม่มีรายการกำหนดการสำหรับส่งออก');
        const stage = root.document.createElement('div');
        stage.setAttribute('aria-hidden', 'true'); stage.inert = true;
        stage.id = 'agenda-export-stage';
        stage.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none;';
        stage.innerHTML = `<style>${STYLE}</style>`;
        root.document.body.appendChild(stage);
        try {
            const qrImages = new Map();
            snapshot.groups.forEach(day => day.entries.forEach(entry => {
                const url = safeUrl(entry.meetingUrl);
                if (url && !qrImages.has(url)) {
                    const qr = root.qrcode(0, 'M'); qr.addData(url); qr.make();
                    qrImages.set(url, qr.createDataURL(6, 24));
                }
            }));
            const pages = [];
            snapshot.groups.forEach(day => {
                let page;
                let body;
                let dayPage = 0;
                const addPage = () => {
                    dayPage++;
                    stage.insertAdjacentHTML('beforeend', pageHtml(snapshot, day, kind, dayPage > 1, qrImages));
                    page = stage.lastElementChild; body = page.querySelector('tbody');
                    pages.push({ element: page, day, dayPage });
                };
                addPage();
                const separate = new Set(day.entries.map(entry => safeUrl(entry.meetingUrl)).filter(Boolean)).size > 1;
                day.entries.forEach(entry => {
                    const html = rowHtml(entry, kind, separate, qrImages);
                    body.insertAdjacentHTML('beforeend', html);
                    const content = page.querySelector('.ae-content');
                    if (content.scrollHeight > content.clientHeight + 1) {
                        body.lastElementChild.remove();
                        if (!body.children.length) throw new Error('ข้อความในบางรายการยาวเกินหน้ากระดาษ กรุณาตรวจสอบข้อมูลรายวิชา');
                        addPage(); body.insertAdjacentHTML('beforeend', html);
                        const nextContent = page.querySelector('.ae-content');
                        if (nextContent.scrollHeight > nextContent.clientHeight + 1) throw new Error('ข้อความในบางรายการยาวเกินหน้ากระดาษ');
                    }
                });
            });
            pages.forEach((page, index) => {
                page.element.querySelector('.ae-page-number').textContent = `หน้า ${index + 1} / ${pages.length}`;
                page.dayPages = pages.filter(other => other.day === page.day).length;
            });
            await Promise.all([...stage.querySelectorAll('img')].map(img => img.decode()));
            abortIfNeeded(signal);
            return { stage, pages };
        } catch (error) { stage.remove(); throw error; }
    }

    async function capture(element, signal) {
        abortIfNeeded(signal);
        const canvas = await root.html2canvas(element, {
            scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true,
            windowWidth: 1200, windowHeight: 1800, scrollX: 0, scrollY: 0,
            ignoreElements: element => ['IFRAME', 'CANVAS', 'DIALOG'].includes(element.tagName)
        });
        abortIfNeeded(signal);
        return canvas;
    }

    async function createPdf(snapshot, progress, signal) {
        await loadLibrary('pdf', () => typeof root.jspdf?.jsPDF === 'function');
        const { stage, pages } = await layout(snapshot, 'pdf', signal);
        try {
            const pdf = new root.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
            pdf.setProperties({ title: 'กำหนดการประชุมวิพากษ์รายวิชา', author: 'สาขาวิชาสาธารณสุขชุมชน', creator: 'Course Review Dashboard' });
            for (let index = 0; index < pages.length; index++) {
                progress?.(`กำลังสร้าง PDF หน้า ${index + 1}/${pages.length}`);
                const { element } = pages[index];
                const canvas = await capture(element, signal);
                if (index) pdf.addPage();
                pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297);
                canvas.width = 0; canvas.height = 0;
                const bounds = element.getBoundingClientRect();
                element.querySelectorAll('a[href]').forEach(link => {
                    const url = safeUrl(link.href);
                    const rect = link.getBoundingClientRect();
                    if (url) pdf.link((rect.left - bounds.left) / bounds.width * 210, (rect.top - bounds.top) / bounds.height * 297,
                        rect.width / bounds.width * 210, rect.height / bounds.height * 297, { url });
                });
            }
            const firstDay = pages[0].day.key;
            const lastDay = pages[pages.length - 1].day.key;
            const name = firstDay !== lastDay && [firstDay, lastDay].every(key => /^\d{4}-\d{2}-\d{2}$/.test(key))
                ? `course-review-agenda-${firstDay}-to-${lastDay}.pdf` : filename(firstDay, 'pdf');
            return { blob: pdf.output('blob'), filename: name, pageCount: pages.length };
        } finally { stage.remove(); }
    }

    async function createImages(snapshot, progress, signal) {
        const { stage, pages } = await layout(snapshot, 'image', signal);
        try {
            const images = [];
            for (let index = 0; index < pages.length; index++) {
                progress?.(`กำลังสร้างรูปภาพ ${index + 1}/${pages.length}`);
                const page = pages[index];
                const canvas = await capture(page.element, signal);
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const width = canvas.width; const height = canvas.height;
                canvas.width = 0; canvas.height = 0;
                if (!blob) throw new Error('สร้างรูปภาพไม่สำเร็จ');
                images.push({ blob, width, height, filename: filename(page.day.key, 'image', page.dayPage, page.dayPages),
                    label: `${page.day.label}${page.dayPages > 1 ? ` (หน้า ${page.dayPage}/${page.dayPages})` : ''}` });
            }
            return images;
        } finally { stage.remove(); }
    }

    const api = { createPdf, createImages, rowHtml, filename, safeUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.AgendaExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
