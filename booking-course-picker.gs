/** Install this file in Apps Script opened from the booking spreadsheet. */
const BOOKING_PICKER_CONFIG = {
  SPREADSHEET_ID: '196bNk_5oN-vo-zP0eiDTM610Oq09j7Pz4J50YPvOTKw',
  SHEET_ID: 0,
  CATALOG_SHEET_NAME: '_BookingCourses',
  SOURCE_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRnyAkoSHkzZLSppamsaqI8WyuwzGNwVT8a6zdXe9bCP8Ju5Z265rEsXq5MAqgHdHUcaw3m9JS4nSGX/pub?gid=486231050&single=true&output=csv'
};

var BookingCoursePicker = (function () {
  function text(value) {
    return String(value == null ? '' : value).normalize('NFKC').trim()
      .replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
  }

  function code(value) {
    return text(value).toUpperCase().replace(/[\s_\-/]/g, '');
  }

  function column(row, names) {
    const normalized = names.map(value => text(value).replace(/\s+/g, ''));
    return row.findIndex(value => normalized.includes(text(value).replace(/\s+/g, '')));
  }

  function integer(value) {
    const match = text(value).match(/\d+/);
    return match ? String(Number(match[0])) : '';
  }

  function termYear(term, year) {
    const t = integer(term);
    const y = integer(year);
    return /^[1-3]$/.test(t) && /^(20|25)\d{2}$/.test(y)
      ? `${t}/${Number(y) < 2400 ? Number(y) + 543 : y}` : '';
  }

  function titleTerms(value) {
    const match = text(value).match(/([1-3](?:\s*[-–,]\s*[1-3])*)\s*\/\s*((?:25|20)\d{2})/);
    if (!match) return [];
    let terms = match[1].match(/[1-3]/g);
    if (/[-–]/.test(match[1]) && terms.length === 2) {
      const start = Number(terms[0]);
      const end = Number(terms[1]);
      if (end < start) throw new Error('ช่วงภาคการศึกษาในหัวเรื่องไม่ถูกต้อง');
      terms = Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
    }
    return [...new Set(terms.map(term => termYear(term, match[2])))];
  }

  function catalog(rows) {
    if (!rows.length) throw new Error('ชีตสรุปรายวิชาไม่มีข้อมูล');
    const headers = rows[0];
    const fields = {
      code: column(headers, ['รหัสวิชา', 'รหัส']),
      name: column(headers, ['ชื่อรายวิชา', 'รายวิชา']),
      level: column(headers, ['ชั้นปี']),
      term: column(headers, ['ภาคการศึกษา', 'เทอม']),
      year: column(headers, ['ปีการศึกษา'])
    };
    if (Object.values(fields).some(index => index < 0)) {
      throw new Error('ชีตสรุปต้องมี รหัสวิชา ชื่อรายวิชา ชั้นปี ภาคการศึกษา และปีการศึกษา');
    }
    const seen = new Set();
    const result = [];
    rows.slice(1).forEach(row => {
      const course = {
        code: String(row[fields.code] || '').trim(),
        name: String(row[fields.name] || '').trim(),
        level: integer(row[fields.level]),
        termYear: termYear(row[fields.term], row[fields.year])
      };
      if (!course.code || !course.name || !course.termYear || !course.level) return;
      const key = JSON.stringify([code(course.code), course.name, course.level, course.termYear]);
      if (!seen.has(key)) { seen.add(key); result.push(course); }
    });
    if (!result.length) throw new Error('ไม่พบรายวิชาที่มีรหัส ชั้นปี และภาคการศึกษาครบถ้วน');
    return result;
  }

  function slots(rows) {
    let columns = null;
    let scope = [];
    const result = [];
    rows.forEach((row, index) => {
      const nameIndex = column(row, ['รายวิชา', 'ชื่อรายวิชา']);
      const timeIndex = column(row, ['เวลา', 'เวลานำเสนอ']);
      if (nameIndex >= 0 && timeIndex >= 0) {
        const previous = columns;
        columns = {
          name: nameIndex, time: timeIndex,
          order: column(row, ['ลำดับ']),
          code: column(row, ['รหัสวิชา', 'รหัส']), level: column(row, ['ชั้นปี']),
          term: column(row, ['ภาคการศึกษา', 'เทอม']), year: column(row, ['ปีการศึกษา'])
        };
        if (previous && previous.name === columns.name && previous.time === columns.time) {
          ['code', 'level', 'term', 'year'].forEach(key => {
            if (columns[key] < 0 && previous[key] >= 0 && text(row[previous[key]]) === '') columns[key] = previous[key];
          });
        }
        if (columns.code < 0 || columns.level < 0) throw new Error(`หัวตารางแถว ${index + 1} ต้องมี รหัสวิชา และชั้นปี`);
        return;
      }
      const terms = titleTerms(row[0]);
      if (terms.length) { scope = terms; return; }
      if (!columns || !/^\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}$/.test(text(row[columns.time]))) return;
      if (columns.order >= 0 && !/^\d+$/.test(text(row[columns.order]))) return;
      if (/^(พัก|พักเที่ยง|ว่าง|ยกเลิก)$/.test(text(row[columns.name]))) return;
      const explicitTerm = termYear(row[columns.term], row[columns.year]);
      const coveredTerms = explicitTerm ? [explicitTerm] : scope;
      if (!coveredTerms.length) throw new Error(`ไม่พบภาคการศึกษาของแถว ${index + 1} เช่น 2-3/2569`);
      result.push({ row: index + 1, ...columns, terms: [...coveredTerms] });
    });
    if (!result.length) throw new Error('ไม่พบช่องเวลาลงทะเบียนในตาราง');
    return result;
  }

  function choices(courses, terms) {
    const available = courses.filter(course => terms.includes(course.termYear));
    if (!available.length) throw new Error(`ไม่พบรายวิชาในภาคการศึกษา ${terms.join(', ')}`);
    const identities = new Set();
    available.forEach(course => {
      const identity = JSON.stringify([code(course.code), course.level, course.termYear]);
      if (identities.has(identity)) throw new Error(`ชีตสรุปมีรหัส ${course.code} ชั้นปี ${course.level} เทอม ${course.termYear} ซ้ำ กรุณาตรวจสอบข้อมูลต้นทาง`);
      identities.add(identity);
    });
    return available.map(course => {
      const duplicates = available.filter(other => code(other.code) === code(course.code));
      const label = duplicates.length === 1 ? course.code
        : `${course.code} | ${course.name} | ปี ${course.level} | ${course.termYear}`;
      return { label, course };
    }).sort((a, b) => a.label.localeCompare(b.label, 'th', { numeric: true }));
  }

  function resolve(value, options, level, useLevel) {
    const selection = text(value);
    if (!selection) return { kind: 'clear' };
    let matches = options.filter(option => text(option.label) === selection);
    if (!matches.length) {
      matches = options.filter(option => code(option.course.code) === code(selection));
      if (matches.length > 1 && useLevel) matches = matches.filter(option => option.course.level === integer(level));
    }
    if (matches.length !== 1) return {
      kind: 'error', message: matches.length ? 'รหัสนี้มีหลายรายวิชา กรุณาเลือกตัวเลือกที่ระบุชื่อวิชา ชั้นปี และเทอม'
        : 'ไม่พบรหัสวิชานี้ในภาคการศึกษาของตาราง กรุณาเลือกจากรายการ'
    };
    return { kind: 'fill', course: matches[0].course };
  }

  return { catalog, slots, choices, resolve, code };
})();

function setupBookingCoursePicker() {
  const book = bookingPickerBook_();
  bookingPickerWithLock_(() => {
    const courses = bookingPickerFetchCatalog_();
    const sheet = book.getSheetById(BOOKING_PICKER_CONFIG.SHEET_ID);
    if (!sheet) throw new Error('ไม่พบแท็บลงเวลา gid=0');
    const rows = sheet.getDataRange().getDisplayValues();
    const slots = BookingCoursePicker.slots(rows);
    slots.forEach(slot => BookingCoursePicker.choices(courses, slot.terms));
    bookingPickerSaveCatalog_(book, courses);
    bookingPickerConfigure_(sheet, rows, slots, courses, true);
    bookingPickerInstallTriggers_(book);
  });
  bookingPickerMenu_();
  book.toast('ติดตั้งตัวเลือกรหัสวิชาและการเติมชื่อ/ชั้นปีอัตโนมัติแล้ว', 'ลงเวลารายวิชา', 8);
}

function refreshBookingCoursePicker() {
  const book = bookingPickerBook_();
  bookingPickerWithLock_(() => {
    const courses = bookingPickerFetchCatalog_();
    const sheet = book.getSheetById(BOOKING_PICKER_CONFIG.SHEET_ID);
    if (!sheet) throw new Error('ไม่พบแท็บลงเวลา gid=0');
    const rows = sheet.getDataRange().getDisplayValues();
    const slots = BookingCoursePicker.slots(rows);
    slots.forEach(slot => BookingCoursePicker.choices(courses, slot.terms));
    bookingPickerSaveCatalog_(book, courses);
    bookingPickerConfigure_(sheet, rows, slots, courses, false);
  });
  book.toast('อัปเดตรายการรหัสวิชาจากชีตสรุปแล้ว', 'ลงเวลารายวิชา', 5);
}

function bookingCoursePickerOnOpen(event) {
  if (!event || !event.source || event.source.getId() !== BOOKING_PICKER_CONFIG.SPREADSHEET_ID) return;
  bookingPickerMenu_();
  try { refreshBookingCoursePicker(); }
  catch (error) { event.source.toast(`อัปเดตรายวิชาไม่ได้: ${error.message}`, 'ลงเวลารายวิชา', 10); console.error(error); }
}

function bookingCoursePickerOnEdit(event) {
  if (!event || !event.range || !event.source || event.source.getId() !== BOOKING_PICKER_CONFIG.SPREADSHEET_ID) return;
  const sheet = event.range.getSheet();
  if (sheet.getSheetId() !== BOOKING_PICKER_CONFIG.SHEET_ID) return;
  try {
    bookingPickerWithLock_(() => {
      const rows = sheet.getDataRange().getDisplayValues();
      const slots = BookingCoursePicker.slots(rows).filter(slot =>
        slot.row >= event.range.getRow() && slot.row <= event.range.getLastRow() &&
        slot.code + 1 >= event.range.getColumn() && slot.code + 1 <= event.range.getLastColumn());
      if (!slots.length) return;
      const courses = bookingPickerReadCatalog_(event.source);
      slots.forEach(slot => {
        const row = rows[slot.row - 1];
        const options = BookingCoursePicker.choices(courses, slot.terms);
        const levelIncluded = slot.level + 1 >= event.range.getColumn() && slot.level + 1 <= event.range.getLastColumn();
        const sameCode = event.range.getNumRows() === 1 && event.oldValue != null &&
          BookingCoursePicker.code(event.oldValue) === BookingCoursePicker.code(row[slot.code]);
        const result = BookingCoursePicker.resolve(row[slot.code], options, row[slot.level], levelIncluded || sameCode);
        const applied = bookingPickerApply_(sheet, slot, options, result, true);
        if (applied.kind === 'error') event.source.toast(`แถว ${slot.row}: ${applied.message}`, 'ลงเวลารายวิชา', 8);
      });
    });
  } catch (error) { event.source.toast(`เติมข้อมูลไม่ได้: ${error.message}`, 'ลงเวลารายวิชา', 10); console.error(error); }
}

function disableBookingCoursePicker() {
  const book = bookingPickerBook_();
  const handlers = ['bookingCoursePickerOnEdit', 'bookingCoursePickerOnOpen'];
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (handlers.includes(trigger.getHandlerFunction()) && trigger.getTriggerSourceId() === book.getId()) ScriptApp.deleteTrigger(trigger);
  });
  book.toast('ปิดการเติมข้อมูลอัตโนมัติแล้ว ข้อมูลเดิมยังอยู่', 'ลงเวลารายวิชา', 6);
}

function bookingPickerMenu_() {
  SpreadsheetApp.getUi().createMenu('ลงเวลารายวิชา')
    .addItem('ติดตั้ง / เติมชื่อและชั้นปีรายการเดิม', 'setupBookingCoursePicker')
    .addItem('อัปเดตรายการรหัสวิชา', 'refreshBookingCoursePicker')
    .addItem('ปิดการเติมข้อมูลอัตโนมัติ', 'disableBookingCoursePicker')
    .addToUi();
}

function bookingPickerBook_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== BOOKING_PICKER_CONFIG.SPREADSHEET_ID) {
    throw new Error('กรุณาเปิด Apps Script จากชีตลงเวลา แล้วรัน setupBookingCoursePicker');
  }
  return book;
}

function bookingPickerWithLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('กำลังอัปเดตข้อมูล กรุณาเลือกอีกครั้ง');
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function bookingPickerFetchCatalog_() {
  const response = UrlFetchApp.fetch(BOOKING_PICKER_CONFIG.SOURCE_CSV_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error(`อ่านชีตสรุปไม่ได้ (HTTP ${response.getResponseCode()})`);
  const csv = response.getContentText('UTF-8').replace(/^\uFEFF/, '');
  if (/^\s*</.test(csv)) throw new Error('ชีตสรุปไม่ได้เผยแพร่ CSV หรือไม่มีสิทธิ์อ่าน');
  return BookingCoursePicker.catalog(Utilities.parseCsv(csv));
}

function bookingPickerSaveCatalog_(book, courses) {
  const marker = 'CPH_BOOKING_COURSE_PICKER_V1';
  let sheet = book.getSheetByName(BOOKING_PICKER_CONFIG.CATALOG_SHEET_NAME);
  if (sheet && sheet.getRange('H1').getDisplayValue() !== marker) throw new Error('มีชีตชื่อ _BookingCourses อยู่แล้วและไม่ได้สร้างจากสคริปต์นี้');
  if (!sheet) {
    sheet = book.insertSheet(BOOKING_PICKER_CONFIG.CATALOG_SHEET_NAME);
    sheet.getRange('H1').setValue(marker);
  }
  const oldLastRow = sheet.getLastRow();
  const values = [['รหัสวิชา', 'ชื่อรายวิชา', 'ชั้นปี', 'ภาคการศึกษา', 'ปีการศึกษา'], ...courses.map(course => {
    const [term, year] = course.termYear.split('/');
    return [course.code, course.name, Number(course.level), Number(term), Number(year)];
  })];
  sheet.getRange(1, 1, values.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, values.length, 5).setValues(values);
  if (oldLastRow > values.length) sheet.getRange(values.length + 1, 1, oldLastRow - values.length, 5).clearContent();
  sheet.getRange('H2').setValue(BOOKING_PICKER_CONFIG.SOURCE_CSV_URL);
  sheet.getRange('H3').setValue(new Date()).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.setFrozenRows(1);
  sheet.hideSheet();
}

function bookingPickerReadCatalog_(book) {
  const sheet = book.getSheetByName(BOOKING_PICKER_CONFIG.CATALOG_SHEET_NAME);
  if (!sheet || sheet.getRange('H1').getDisplayValue() !== 'CPH_BOOKING_COURSE_PICKER_V1') throw new Error('กรุณารัน setupBookingCoursePicker ก่อน');
  return BookingCoursePicker.catalog(sheet.getRange(1, 1, sheet.getLastRow(), 5).getDisplayValues());
}

function bookingPickerConfigure_(sheet, rows, slots, courses, fillExisting) {
  slots.forEach(slot => {
    const row = rows[slot.row - 1];
    const options = BookingCoursePicker.choices(courses, slot.terms);
    const result = BookingCoursePicker.resolve(row[slot.code], options, row[slot.level], true);
    // Setup preserves manually entered courses that have no code yet.
    bookingPickerValidation_(sheet.getRange(slot.row, slot.code + 1), options, result.kind === 'fill' ? result.course.code : '');
    if (fillExisting && result.kind !== 'clear') bookingPickerApply_(sheet, slot, options, result, false);
  });
}

function bookingPickerValidation_(cell, options, currentCode) {
  const values = [...new Set(options.map(option => option.label).concat(currentCode ? [currentCode] : []))];
  cell.setNumberFormat('@').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(false).setHelpText('เลือกรหัสวิชา ถ้ารหัสซ้ำให้เลือกตัวเลือกที่ระบุชั้นปีและเทอม').build());
}

function bookingPickerApply_(sheet, slot, options, result, edited) {
  const cell = sheet.getRange(slot.row, slot.code + 1);
  if (result.kind === 'fill' && (slot.term < 0 || slot.year < 0) && options.some(option =>
    BookingCoursePicker.code(option.course.code) === BookingCoursePicker.code(result.course.code) &&
    option.course.level === result.course.level && option.course.termYear !== result.course.termYear)) {
    result = { kind: 'error', message: 'รหัสนี้เปิดให้ชั้นปีเดียวกันหลายเทอม กรุณาเพิ่มคอลัมน์ ภาคการศึกษา และปีการศึกษา เพื่อระบุเทอมของแถวนี้' };
  }
  if (result.kind === 'fill') {
    bookingPickerValidation_(cell, options, result.course.code);
    cell.setNumberFormat('@').setValue(result.course.code);
    bookingPickerNote_(cell, '');
    sheet.getRange(slot.row, slot.name + 1).setValue(result.course.name);
    sheet.getRange(slot.row, slot.level + 1).setValue(Number(result.course.level));
    if (slot.term >= 0 && slot.year >= 0) {
      const [term, year] = result.course.termYear.split('/');
      sheet.getRange(slot.row, slot.term + 1).setValue(Number(term));
      sheet.getRange(slot.row, slot.year + 1).setValue(Number(year));
    }
  } else if (result.kind === 'clear' || edited) {
    bookingPickerValidation_(cell, options, '');
    sheet.getRange(slot.row, slot.name + 1).clearContent();
    sheet.getRange(slot.row, slot.level + 1).clearContent();
    bookingPickerNote_(cell, result.kind === 'error' ? result.message : '');
  } else {
    bookingPickerNote_(cell, result.message);
  }
  return result;
}

function bookingPickerNote_(cell, message) {
  const prefix = '[ตัวเลือกรายวิชา] ';
  const previous = cell.getNote() || '';
  const notes = previous ? previous.split('\n').filter(line => !line.startsWith(prefix)) : [];
  if (message) notes.push(prefix + message);
  cell.setNote(notes.join('\n') || null);
}

function bookingPickerInstallTriggers_(book) {
  const handlers = { bookingCoursePickerOnEdit: 'onEdit', bookingCoursePickerOnOpen: 'onOpen' };
  const existing = ScriptApp.getProjectTriggers();
  Object.keys(handlers).forEach(handler => {
    if (existing.some(trigger => trigger.getHandlerFunction() === handler && trigger.getTriggerSourceId() === book.getId())) return;
    const builder = ScriptApp.newTrigger(handler).forSpreadsheet(book);
    builder[handlers[handler]]().create();
  });
}
