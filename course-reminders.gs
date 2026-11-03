/** Manual-only reminders. Install in the summary spreadsheet with booking-sync.js as a .gs file. */
const APCRIS_REMINDER_CONFIG = {
  SUMMARY_SHEET_ID: 486231050,
  ADMIN_EMAILS: [], // The spreadsheet owner is allowed by default; add other administrators here.
  BOOKING_SPREADSHEET_ID: '196bNk_5oN-vo-zP0eiDTM610Oq09j7Pz4J50YPvOTKw',
  BOOKING_SHEET_ID: 0,
  BOOKING_URL: 'https://docs.google.com/spreadsheets/d/196bNk_5oN-vo-zP0eiDTM610Oq09j7Pz4J50YPvOTKw/edit#gid=0',
  DASHBOARD_URL: '',
  COOLDOWN_DAYS: 7,
  PREVIEW_SECONDS: 600,
  MAX_RECIPIENTS: 30,
  LOG_SHEET: '_APCRIS_ReminderLog'
};

var ApcrisReminders = (function () {
  function text(value) { return String(value == null ? '' : value).normalize('NFKC').trim(); }
  function column(headers, names) {
    const normalize = value => text(value).replace(/\s+/g, '').toLowerCase();
    return headers.findIndex(header => names.map(normalize).includes(normalize(header)));
  }
  function email(value) {
    const result = text(value).toLowerCase();
    return result.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(result)
      && !result.split('@')[0].includes('..') && !/^\.|\.$/.test(result.split('@')[0]) ? result : '';
  }
  function emails(value) {
    const tokens = [...new Set(text(value).split(/[,;\s]+/).filter(Boolean))];
    return { valid: [...new Set(tokens.map(email).filter(Boolean))], invalid: tokens.filter(value => !email(value)) };
  }
  function integer(value) {
    const normalized = text(value).replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
    const match = normalized.match(/^\D*(\d+)\D*$/);
    return match ? Number(match[1]) : 0;
  }
  function truthy(value) { return text(value).toUpperCase() === 'TRUE'; }
  function safeUrl(value) {
    const url = text(value);
    // Apps Script V8 does not provide the browser URL constructor.
    return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(url) ? url : '';
  }
  function escape(value) { return text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function options(value) {
    if (!value || !Array.isArray(value.terms) || !value.terms.length) throw new Error('กรุณาเลือกภาคการศึกษาที่ต้องการเตือน');
    const terms = [...new Set(value.terms.map(text))].sort();
    if (terms.some(term => !/^[1-3]\/25\d{2}$/.test(term))) throw new Error('ภาคการศึกษาไม่ถูกต้อง');
    const result = { terms, booking: value.booking === true, upload34: value.upload34 === true, upload56: value.upload56 === true };
    if (!result.booking && !result.upload34 && !result.upload56) throw new Error('กรุณาเลือกงานที่ต้องการเตือน');
    ['bookingDeadline', 'uploadDeadline'].forEach(key => {
      const date = text(value[key]);
      if (date && (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('กำหนดส่งไม่ถูกต้อง');
      result[key] = date;
    });
    return result;
  }
  function courses(rows, selected, richLinks) {
    const headers = rows[0] || [];
    const fields = {
      id: column(headers, ['รหัสวิชา', 'รหัส', 'Course Code', 'course_code']),
      name: column(headers, ['ชื่อรายวิชา', 'รายวิชา', 'Course Name']),
      year: column(headers, ['ชั้นปี']), term: column(headers, ['ภาคการศึกษา', 'เทอม']),
      academicYear: column(headers, ['ปีการศึกษา']),
      instructor: column(headers, ['ผู้รับผิดชอบรายวิชา 2569', 'ผู้รับผิดชอบรายวิชา', 'ผู้รับผิดชอบ', 'อาจารย์']),
      email: column(headers, ['อีเมล', 'อีเมลผู้รับผิดชอบ', 'อีเมลอาจารย์', 'Instructor Email', 'teacher_email']),
      upload: column(headers, ['อัพไฟล์', 'อัปโหลดไฟล์', 'Uploaded']),
      fileLink: column(headers, ['ลิงก์ไฟล์', 'Link', 'ลิงค์ไฟล์ มคอ.']),
      upload56: column(headers, ['อัพไฟล์ 5-6', 'อัปโหลดไฟล์ 5-6']),
      fileLink56: column(headers, ['ลิงค์ไฟล์ มคอ. 5-6', 'ลิงก์ไฟล์ มคอ. 5-6']),
      folderLink: column(headers, ['ลิงก์โฟลเดอร์อัปโหลด', 'Drive Folder Link', 'Folder Link']),
      folderId: column(headers, ['Drive Folder ID', 'Folder ID'])
    };
    if (['id', 'name', 'year', 'term', 'academicYear', 'email'].some(key => fields[key] < 0)) throw new Error('ชีตสรุปต้องมี รหัสวิชา ชื่อรายวิชา ชั้นปี ภาคการศึกษา ปีการศึกษา และอีเมล');
    if (selected.upload34 && fields.upload < 0 && fields.fileLink < 0) throw new Error('ไม่พบคอลัมน์สถานะหรือลิงก์ มคอ.3-4');
    if (selected.upload56 && fields.upload56 < 0 && fields.fileLink56 < 0) throw new Error('ไม่พบคอลัมน์สถานะหรือลิงก์ มคอ.5-6');
    const result = [];
    const warnings = [];
    const seen = new Set();
    rows.slice(1).forEach((row, index) => {
      const id = text(row[fields.id]);
      if (!id || ['จำนวน', 'ร้อยละ', '-'].includes(id)) return;
      const name = text(row[fields.name]);
      const term = integer(row[fields.term]);
      const rawYear = integer(row[fields.academicYear]);
      const year = integer(row[fields.year]);
      const academicYear = rawYear < 2400 ? rawYear + 543 : rawYear;
      if (!name || ![1, 2, 3].includes(term) || academicYear < 2500 || academicYear > 2599 || !year) {
        warnings.push(`แถว ${index + 2}: ข้อมูลรายวิชาหรือภาคการศึกษาไม่ครบ จึงไม่ส่งเตือนแถวนี้`);
        return;
      }
      const termYear = `${term}/${academicYear}`;
      const key = JSON.stringify([id.toUpperCase().replace(/[\s_\-/]/g, ''), year, termYear]);
      if (seen.has(key)) throw new Error(`รายวิชาซ้ำ: ${id} ชั้นปี ${year} เทอม ${termYear} กรุณาตรวจข้อมูลก่อนส่ง`);
      seen.add(key);
      const addresses = emails(row[fields.email]);
      if (selected.terms.includes(termYear) && (addresses.invalid.length || !addresses.valid.length)) warnings.push(`แถว ${index + 2}: ตรวจอีเมลของ ${id} (${addresses.invalid.join(', ') || 'ยังไม่มีอีเมล'})`);
      const link = key => text(richLinks?.[index + 1]?.[fields[key]] || row[fields[key]]);
      const folderId = text(row[fields.folderId]);
      const folderUrl = safeUrl(link('folderLink')) || (/^[a-zA-Z0-9_-]{10,}$/.test(folderId) ? `https://drive.google.com/drive/folders/${folderId}` : '');
      result.push({ key, id, name, year, termYear, instructor: text(row[fields.instructor]), emails: addresses.valid,
        upload: truthy(row[fields.upload]) || Boolean(link('fileLink')),
        upload56: truthy(row[fields.upload56]) || Boolean(link('fileLink56')),
        folderUrl, booking: false, presented: false });
    });
    if (!result.length) throw new Error('ไม่พบข้อมูลรายวิชาที่ใช้ส่งเตือนได้');
    return { courses: result, warnings };
  }
  function pending(data, selected, schedule, bookingSync) {
    let courses = data;
    if (selected.booking) {
      if (!bookingSync || !schedule) throw new Error('ยังไม่ได้ติดตั้ง BookingSync หรืออ่านชีตลงเวลาไม่ได้');
      if (selected.terms.some(term => !schedule.coveredTerms.includes(term))) throw new Error('ชีตลงเวลาไม่ครอบคลุมเทอมที่เลือก กรุณาเปลี่ยนเทอมหรือปิดการเตือนลงเวลา');
      const merged = bookingSync.merge(data, schedule);
      if (merged.issues.some(issue => issue.terms.some(term => selected.terms.includes(term)))) throw new Error('มีรายการลงเวลาที่จับคู่รายวิชาไม่ได้ กรุณาตรวจรหัส/ชั้นปีก่อนส่งเตือน');
      courses = merged.data;
    }
    const groups = new Map();
    courses.filter(course => selected.terms.includes(course.termYear)).forEach(course => {
      const reasons = [];
      if (selected.booking && !course.booking) reasons.push('ยังไม่ลงเวลา');
      if (selected.upload34 && !course.upload) reasons.push('ยังไม่ส่ง มคอ.3-4');
      if (selected.upload56 && !course.upload56) reasons.push('ยังไม่ส่ง มคอ.5-6');
      if (!reasons.length) return;
      course.emails.forEach(email => {
        if (!groups.has(email)) groups.set(email, { email, names: [], items: [] });
        const group = groups.get(email);
        if (course.instructor && !group.names.includes(course.instructor)) group.names.push(course.instructor);
        group.items.push({ key: course.key, id: course.id, name: course.name, year: course.year, termYear: course.termYear, reasons, folderUrl: course.folderUrl });
      });
    });
    return [...groups.values()].sort((a, b) => a.email.localeCompare(b.email)).map(group => ({ ...group,
      names: group.names.sort(), items: group.items.sort((a, b) => a.key.localeCompare(b.key)) }));
  }
  function dateLabel(value) {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return `${day}/${month}/${year + 543}`;
  }
  function message(group, selected, config) {
    const terms = [...new Set(group.items.map(item => item.termYear))].join(', ');
    const subject = `[APCRIS] แจ้งเตือนงานรายวิชาที่ยังไม่ครบ (${terms})`;
    const deadlines = [selected.booking && selected.bookingDeadline ? `กำหนดลงเวลา: ${dateLabel(selected.bookingDeadline)}` : '',
      (selected.upload34 || selected.upload56) && selected.uploadDeadline ? `กำหนดส่งเอกสาร: ${dateLabel(selected.uploadDeadline)}` : ''].filter(Boolean);
    const links = [{ label: 'เปิดชีตลงเวลา', url: safeUrl(config.BOOKING_URL) }, { label: 'เปิด APCRIS', url: safeUrl(config.DASHBOARD_URL) }].filter(link => link.url);
    const body = ['เรียน อาจารย์ผู้รับผิดชอบรายวิชา', '', 'ขณะตรวจสอบข้อมูลใน APCRIS พบรายการที่ยังไม่ครบดังนี้:', '',
      ...group.items.map(item => `${item.id} ${item.name} | ชั้นปี ${item.year} | เทอม ${item.termYear}\n- ${item.reasons.join(', ')}${item.folderUrl ? `\nโฟลเดอร์อัปโหลด: ${item.folderUrl}` : ''}`),
      '', ...deadlines, ...links.map(link => `${link.label}: ${link.url}`), '',
      'หากดำเนินการแล้วแต่ข้อมูลยังไม่ปรากฏ กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบสถานะ', 'ขอบคุณครับ/ค่ะ', 'APCRIS | ระบบสารสนเทศการวิพากษ์รายวิชา'].join('\n');
    const rows = group.items.map(item => `<tr><td style="padding:14px 0;border-bottom:1px solid #dbe3ed;overflow-wrap:anywhere"><strong>${escape(item.id)} ${escape(item.name)}</strong><br><span style="color:#526176">ชั้นปี ${item.year} / ภาคการศึกษา ${escape(item.termYear)}</span><br>${escape(item.reasons.join(', '))}${item.folderUrl ? `<br><a href="${escape(item.folderUrl)}">โฟลเดอร์อัปโหลด</a>` : ''}</td></tr>`).join('');
    const htmlBody = `<html lang="th"><body style="margin:0;padding:20px;background:#f3f5f7;font:15px/1.8 Tahoma,sans-serif;color:#253246"><div style="max-width:640px;margin:auto;background:white;padding:24px;border-top:5px solid #2563eb"><h1 style="font-size:23px;margin:0;color:#1d4ed8">APCRIS</h1><p style="font-size:12px;color:#526176;margin:0 0 20px">Course Review Information System</p><p>เรียน อาจารย์ผู้รับผิดชอบรายวิชา</p><p>ขณะตรวจสอบข้อมูล พบรายการที่ยังไม่ครบดังนี้:</p><table style="width:100%;border-collapse:collapse;table-layout:fixed">${rows}</table>${deadlines.map(line => `<p>${escape(line)}</p>`).join('')}<p>${links.map(link => `<a href="${escape(link.url)}" style="margin-right:16px">${link.label}</a>`).join('')}</p><p style="font-size:13px;color:#526176">หากดำเนินการแล้วแต่ข้อมูลยังไม่ปรากฏ กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบสถานะ</p><p>ขอบคุณครับ/ค่ะ<br>APCRIS | ระบบสารสนเทศการวิพากษ์รายวิชา</p></div></body></html>`;
    return { subject, body, htmlBody };
  }
  return { options, courses, pending, message, email, safeUrl };
})();

function apcrisReminderMenu_() {
  SpreadsheetApp.getUi().createMenu('APCRIS แจ้งเตือน')
    .addItem('ติดตั้ง / ตรวจการตั้งค่า', 'setupApcrisReminders')
    .addItem('ตรวจรายการและส่งอีเมล', 'openApcrisReminderDialog')
    .addItem('ประวัติการส่ง', 'openApcrisReminderLog')
    .addItem('ยืนยันผลการส่งที่ต้องตรวจสอบ', 'resolveApcrisReminderAttempt')
    .addToUi();
}

function apcrisReminderContext_(setup) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const actor = ApcrisReminders.email(Session.getActiveUser().getEmail());
  const owner = book?.getOwner();
  const admins = APCRIS_REMINDER_CONFIG.ADMIN_EMAILS.map(ApcrisReminders.email).filter(Boolean);
  if (owner) admins.push(ApcrisReminders.email(owner.getEmail()));
  if (!actor || !admins.includes(actor)) throw new Error('เฉพาะเจ้าของชีตหรือผู้ดูแลที่กำหนดเท่านั้น กรุณาเปิดด้วยบัญชีผู้ดูแล');
  if (!book || book.getId() === APCRIS_REMINDER_CONFIG.BOOKING_SPREADSHEET_ID) throw new Error('กรุณาติดตั้งในชีตสรุปรายวิชา ไม่ใช่ชีตลงเวลา');
  const sheet = book.getSheetById(APCRIS_REMINDER_CONFIG.SUMMARY_SHEET_ID);
  if (!sheet) throw new Error('ไม่พบแท็บสรุปรายวิชา กรุณาตรวจ SUMMARY_SHEET_ID');
  const properties = PropertiesService.getDocumentProperties();
  const binding = properties.getProperty('APCRIS_REMINDER_BINDING');
  const identity = JSON.stringify([book.getId(), sheet.getSheetId()]);
  if (!setup && binding !== identity) throw new Error('กรุณารัน setupApcrisReminders ในชีตสรุปก่อน');
  return { book, sheet, actor, properties, identity };
}

function apcrisReminderLock_(callback) {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) throw new Error('กำลังประมวลผลการแจ้งเตือน กรุณารอแล้วตรวจรายการใหม่');
  try { return callback(); } finally { lock.releaseLock(); }
}

function apcrisReminderLog_(context, create) {
  const name = APCRIS_REMINDER_CONFIG.LOG_SHEET;
  const marker = 'APCRIS_REMINDER_LOG_V1';
  const headers = ['รหัสการส่ง', 'เวลาเริ่ม', 'เวลาอัปเดต', 'ผู้ดำเนินการ', 'ผู้รับ', 'สถานะ', 'หัวข้อ', 'รายวิชา / งานค้าง', 'รายละเอียด'];
  let sheet = context.book.getSheetByName(name);
  if (!sheet && create) {
    sheet = context.book.insertSheet(name);
    sheet.getRange(1, 1).setValue(marker);
    sheet.getRange(2, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(2);
    sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold').setBackground('#eaf0f8');
    sheet.setColumnWidth(5, 240); sheet.setColumnWidth(8, 420); sheet.setColumnWidth(9, 320);
  }
  if (!sheet || sheet.getRange(1, 1).getDisplayValue() !== marker || JSON.stringify(sheet.getRange(2, 1, 1, headers.length).getDisplayValues()[0]) !== JSON.stringify(headers)) throw new Error('ไม่พบประวัติแจ้งเตือนที่ถูกต้อง หรือมีชีตชื่อซ้ำ กรุณาตรวจการติดตั้ง');
  return sheet;
}

function setupApcrisReminders(event) {
  if (event) throw new Error('ติดตั้งด้วยการกด Run หรือเมนูเท่านั้น');
  const context = apcrisReminderContext_(true);
  apcrisReminderLock_(() => {
    ApcrisReminders.courses(context.sheet.getDataRange().getDisplayValues(), { terms: [], upload34: true });
    const binding = context.properties.getProperty('APCRIS_REMINDER_BINDING');
    if (binding && binding !== context.identity) throw new Error('การติดตั้งเดิมผูกกับชีตอื่น กรุณาตรวจการตั้งค่า');
    apcrisReminderLog_(context, true);
    context.properties.setProperty('APCRIS_REMINDER_BINDING', context.identity);
  });
  apcrisReminderMenu_();
  context.book.toast('พร้อมใช้งานแบบกดส่งเอง ไม่มีการสร้าง Trigger และยังไม่ส่งอีเมล', 'APCRIS', 8);
}

function openApcrisReminderDialog(event) {
  if (event) throw new Error('เปิดจากเมนูด้วยตนเองเท่านั้น');
  apcrisReminderContext_();
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('course-reminder-dialog').setWidth(1000).setHeight(720), 'APCRIS แจ้งเตือน');
}

function openApcrisReminderLog() {
  const context = apcrisReminderContext_();
  const log = apcrisReminderLock_(() => {
    const sheet = apcrisReminderLog_(context);
    if (sheet.getLastRow() > 2) sheet.getRange(3, 1, sheet.getLastRow() - 2, 9).getValues().forEach((row, index) => {
      if (!['SENDING', 'REVIEW'].includes(row[5]) || !ApcrisReminders.email(row[4])) return;
      const saved = context.properties.getProperty(apcrisReminderGuardKey_(String(row[4])));
      const guard = saved ? JSON.parse(saved) : null;
      // Restore a final result only when the durable guard confirms the same attempt.
      if (guard && guard.id === String(row[0]) && ['SENT', 'NOT_SENT'].includes(guard.status)) {
        sheet.getRange(index + 3, 6).setValue(guard.status);
        sheet.getRange(index + 3, 3).setValue(new Date());
        sheet.getRange(index + 3, 9).setValue('ปรับประวัติให้ตรงกับผลที่บันทึกไว้ในข้อมูลกันส่งซ้ำ');
      }
    });
    return sheet;
  });
  context.book.setActiveSheet(log);
}

function getApcrisReminderOptions() {
  const context = apcrisReminderContext_();
  const data = ApcrisReminders.courses(context.sheet.getDataRange().getDisplayValues(), { terms: [] });
  const terms = [...new Set(data.courses.map(course => course.termYear))].sort((a, b) => {
    const [ta, ya] = a.split('/').map(Number); const [tb, yb] = b.split('/').map(Number);
    return yb - ya || tb - ta;
  });
  const saved = PropertiesService.getUserProperties().getProperty(`APCRIS_REMINDER_OPTIONS_${context.book.getId()}`);
  return { terms, actor: context.actor, previous: saved ? JSON.parse(saved) : null, cooldownDays: APCRIS_REMINDER_CONFIG.COOLDOWN_DAYS };
}

function apcrisReminderSource_(context, selected) {
  const range = context.sheet.getDataRange();
  const rows = range.getDisplayValues();
  const richLinks = range.getRichTextValues().map(row => row.map(cell => cell ? cell.getLinkUrl() || cell.getRuns().map(run => run.getLinkUrl()).find(Boolean) || '' : ''));
  const data = ApcrisReminders.courses(rows, selected, richLinks);
  if (selected.terms.some(term => !data.courses.some(course => course.termYear === term))) throw new Error('ไม่พบเทอมที่เลือกในชีตสรุป กรุณาตรวจรายการใหม่');
  let schedule;
  if (selected.booking) {
    if (typeof BookingSync === 'undefined') throw new Error('กรุณาเพิ่ม booking-sync.js เป็นไฟล์ .gs ใน Apps Script ก่อน');
    try {
      const bookingBook = SpreadsheetApp.openById(APCRIS_REMINDER_CONFIG.BOOKING_SPREADSHEET_ID);
      const bookingSheet = bookingBook.getSheetById(APCRIS_REMINDER_CONFIG.BOOKING_SHEET_ID);
      if (!bookingSheet) throw new Error('ไม่พบแท็บลงเวลา');
      schedule = BookingSync.readSchedule(bookingSheet.getDataRange().getDisplayValues());
    } catch (error) { throw new Error(`อ่านชีตลงเวลาไม่สำเร็จ จึงยังไม่ส่งเตือน: ${error.message || error}`); }
  }
  return { groups: ApcrisReminders.pending(data.courses, selected, schedule, typeof BookingSync === 'undefined' ? null : BookingSync), warnings: data.warnings };
}

function apcrisReminderHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function apcrisReminderGuardKey_(email) { return `APCRIS_REMINDER_GUARD_${apcrisReminderHash_(email)}`; }

function apcrisReminderAttempts_(context) {
  const sheet = apcrisReminderLog_(context);
  const attempts = new Map();
  if (sheet.getLastRow() > 2) sheet.getRange(3, 1, sheet.getLastRow() - 2, 9).getValues().forEach(row => {
    const at = new Date(row[1]).getTime();
    if (!row[0] || !ApcrisReminders.email(row[4]) || !Number.isFinite(at) || !['SENDING', 'SENT', 'REVIEW', 'NOT_SENT'].includes(row[5])) throw new Error('ประวัติแจ้งเตือนมีข้อมูลผิดรูปแบบ กรุณาตรวจประวัติก่อนส่ง');
    attempts.set(String(row[0]), { id: String(row[0]), at, email: String(row[4]), status: row[5] });
  });
  const properties = context.properties.getProperties();
  Object.keys(properties).filter(key => key.startsWith('APCRIS_REMINDER_GUARD_')).forEach(key => {
    const guard = JSON.parse(properties[key]);
    if (!guard.id || !ApcrisReminders.email(guard.email) || !Number.isFinite(guard.at) || !['SENDING', 'SENT', 'REVIEW', 'NOT_SENT'].includes(guard.status)) throw new Error('ข้อมูลป้องกันส่งซ้ำผิดรูปแบบ กรุณาตรวจประวัติ');
    attempts.set(guard.id, guard);
  });
  return [...attempts.values()];
}

function apcrisReminderAvailability_(email, attempts, now) {
  const own = attempts.filter(attempt => attempt.email === email);
  if (own.some(attempt => ['SENDING', 'REVIEW'].includes(attempt.status))) return { eligible: false, reason: 'ต้องยืนยันผลการส่งครั้งก่อน', nextAt: '' };
  const sent = own.filter(attempt => attempt.status === 'SENT').map(attempt => attempt.at);
  const next = sent.length ? Math.max(...sent) + APCRIS_REMINDER_CONFIG.COOLDOWN_DAYS * 86400000 : 0;
  return next > now ? { eligible: false, reason: 'ยังไม่ครบ 7 วัน', nextAt: new Date(next).toISOString() } : { eligible: true, reason: '', nextAt: '' };
}

function apcrisReminderFingerprint_(group, selected) {
  return apcrisReminderHash_(JSON.stringify([group, selected, APCRIS_REMINDER_CONFIG.BOOKING_SPREADSHEET_ID, APCRIS_REMINDER_CONFIG.BOOKING_SHEET_ID, APCRIS_REMINDER_CONFIG.BOOKING_URL, APCRIS_REMINDER_CONFIG.DASHBOARD_URL]));
}

function getApcrisReminderPreview(value) {
  const context = apcrisReminderContext_();
  const selected = ApcrisReminders.options(value);
  const source = apcrisReminderSource_(context, selected);
  const attempts = apcrisReminderAttempts_(context);
  const now = Date.now();
  const groups = source.groups.map(group => ({ ...group, ...apcrisReminderAvailability_(group.email, attempts, now), message: ApcrisReminders.message(group, selected, APCRIS_REMINDER_CONFIG) }));
  const token = Utilities.getUuid();
  const hashes = {};
  source.groups.forEach(group => { hashes[group.email] = apcrisReminderFingerprint_(group, selected); });
  CacheService.getUserCache().put(`APCRIS_REMINDER_PREVIEW_${token}`, JSON.stringify({ book: context.book.getId(), actor: context.actor, selected, hashes, at: now }), APCRIS_REMINDER_CONFIG.PREVIEW_SECONDS);
  PropertiesService.getUserProperties().setProperty(`APCRIS_REMINDER_OPTIONS_${context.book.getId()}`, JSON.stringify(selected));
  return { token, groups, warnings: source.warnings, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + APCRIS_REMINDER_CONFIG.PREVIEW_SECONDS * 1000).toISOString() };
}

function apcrisReminderCell_(value) { const text = String(value || ''); return /^[=+\-@]/.test(text) ? `'${text}` : text; }

function sendApcrisReminders(request) {
  if (!request || request.triggerUid || request.confirmed !== true || typeof request.token !== 'string' || !Array.isArray(request.emails)) throw new Error('ต้องตรวจตัวอย่างและกดยืนยันส่งด้วยตนเองเท่านั้น');
  const context = apcrisReminderContext_();
  return apcrisReminderLock_(() => {
    const cache = CacheService.getUserCache();
    const key = `APCRIS_REMINDER_PREVIEW_${request.token}`;
    const stored = cache.get(key);
    if (!stored) throw new Error('ตัวอย่างหมดอายุหรือถูกใช้แล้ว กรุณาตรวจรายการใหม่');
    const preview = JSON.parse(stored);
    const now = Date.now();
    if (preview.book !== context.book.getId() || preview.actor !== context.actor || now - preview.at > APCRIS_REMINDER_CONFIG.PREVIEW_SECONDS * 1000) throw new Error('ตัวอย่างไม่ตรงกับบัญชีหรือหมดอายุ กรุณาตรวจรายการใหม่');
    const recipients = [...new Set(request.emails.map(ApcrisReminders.email))];
    if (!recipients.length || recipients.includes('') || recipients.length > APCRIS_REMINDER_CONFIG.MAX_RECIPIENTS) throw new Error(`เลือกผู้รับ 1-${APCRIS_REMINDER_CONFIG.MAX_RECIPIENTS} คนต่อครั้ง`);
    const fresh = apcrisReminderSource_(context, preview.selected);
    const attempts = apcrisReminderAttempts_(context);
    const groups = recipients.map(email => {
      const group = fresh.groups.find(group => group.email === email);
      if (!group || !preview.hashes[email] || apcrisReminderFingerprint_(group, preview.selected) !== preview.hashes[email]) throw new Error('ข้อมูลรายวิชาหรือผู้รับเปลี่ยนแล้ว กรุณาตรวจรายการใหม่ก่อนส่ง');
      const availability = apcrisReminderAvailability_(email, attempts, Date.now());
      if (!availability.eligible) throw new Error(`${email}: ${availability.reason} กรุณาตรวจรายการใหม่`);
      return group;
    });
    if (MailApp.getRemainingDailyQuota() < groups.length) throw new Error('โควตาอีเมลวันนี้ไม่พอ ยังไม่มีการส่ง กรุณาลองวันถัดไป');
    cache.remove(key);
    const log = apcrisReminderLog_(context);
    const results = [];
    for (const group of groups) {
      if (Date.now() - now > 150000) { results.push({ email: group.email, status: 'NOT_ATTEMPTED', detail: 'หยุดก่อนหมดเวลาประมวลผล กรุณาตรวจรายการใหม่' }); continue; }
      const message = ApcrisReminders.message(group, preview.selected, APCRIS_REMINDER_CONFIG);
      const attempt = { id: Utilities.getUuid(), at: Date.now(), email: group.email, status: 'SENDING' };
      const guardKey = apcrisReminderGuardKey_(group.email);
      const row = log.getLastRow() + 1;
      const summary = group.items.map(item => `${item.id} ${item.name} / ปี ${item.year} / ${item.termYear}: ${item.reasons.join(', ')}`).join('\n');
      // Persist intent before calling MailApp; an interrupted send must not be retried blindly.
      log.getRange(row, 1, 1, 9).setValues([[attempt.id, new Date(attempt.at), new Date(attempt.at), apcrisReminderCell_(context.actor), apcrisReminderCell_(group.email), 'SENDING', apcrisReminderCell_(message.subject), apcrisReminderCell_(summary), '']]);
      log.getRange(row, 2, 1, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
      context.properties.setProperty(guardKey, JSON.stringify(attempt));
      SpreadsheetApp.flush();
      let accepted = false;
      try {
        MailApp.sendEmail({ to: group.email, subject: message.subject, body: message.body, htmlBody: message.htmlBody, name: 'APCRIS', replyTo: context.actor });
        accepted = true;
        attempt.status = 'SENT';
        context.properties.setProperty(guardKey, JSON.stringify(attempt));
        log.getRange(row, 6).setValue('SENT'); log.getRange(row, 3).setValue(new Date());
        results.push({ email: group.email, status: 'SENT', detail: 'ระบบอีเมลรับคำสั่งส่งแล้ว' });
      } catch (error) {
        attempt.status = accepted ? 'SENT' : 'REVIEW';
        const detail = String(error.message || error).slice(0, 500);
        try {
          context.properties.setProperty(guardKey, JSON.stringify(attempt));
          log.getRange(row, 6).setValue(attempt.status); log.getRange(row, 9).setValue(apcrisReminderCell_(detail));
        } catch (loggingError) { console.error(loggingError); }
        results.push({ email: group.email, status: attempt.status, detail: accepted ? 'ส่งแล้ว แต่บันทึกผลไม่ครบ กรุณาตรวจประวัติ' : 'ต้องตรวจผลก่อนลองส่งใหม่' });
      }
    }
    return { results };
  });
}

function resolveApcrisReminderAttempt() {
  const context = apcrisReminderContext_();
  const ui = SpreadsheetApp.getUi();
  const input = ui.prompt('ตรวจผลการส่งค้าง', 'ระบุอีเมลผู้รับ แล้วตรวจผลกับผู้รับ/ระบบอีเมลก่อนยืนยัน ห้ามเดาผล', ui.ButtonSet.OK_CANCEL);
  if (input.getSelectedButton() !== ui.Button.OK) return;
  const email = ApcrisReminders.email(input.getResponseText());
  if (!email) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const pending = apcrisReminderAttempts_(context).filter(attempt => attempt.email === email && ['SENDING', 'REVIEW'].includes(attempt.status));
  if (pending.length !== 1) throw new Error('ไม่พบรายการค้างหนึ่งรายการที่ตรงกัน กรุณาตรวจประวัติ');
  const answer = ui.alert('ยืนยันผลการส่ง', `${email}\nใช่ = ยืนยันว่าส่งแล้ว\nไม่ใช่ = ยืนยันว่าไม่ได้ส่งและอนุญาตให้ตรวจรายการใหม่\nยกเลิก = ไม่เปลี่ยนสถานะ`, ui.ButtonSet.YES_NO_CANCEL);
  if (![ui.Button.YES, ui.Button.NO].includes(answer)) return;
  apcrisReminderLock_(() => {
    const current = apcrisReminderAttempts_(context).find(attempt => attempt.id === pending[0].id);
    if (!current || !['SENDING', 'REVIEW'].includes(current.status)) throw new Error('สถานะเปลี่ยนแล้ว กรุณาตรวจใหม่');
    const status = answer === ui.Button.YES ? 'SENT' : 'NOT_SENT';
    const log = apcrisReminderLog_(context);
    const ids = log.getRange(3, 1, Math.max(1, log.getLastRow() - 2), 1).getDisplayValues();
    const index = ids.findIndex(row => row[0] === current.id);
    if (index < 0) throw new Error('ไม่พบแถวประวัติ กรุณาตรวจประวัติที่ถูกลบ');
    log.getRange(index + 3, 6).setValue(status);
    log.getRange(index + 3, 3).setValue(new Date());
    log.getRange(index + 3, 9).setValue(`ผู้ยืนยัน: ${context.actor} / ${status}`);
    context.properties.setProperty(apcrisReminderGuardKey_(email), JSON.stringify({ ...current, status }));
  });
}
