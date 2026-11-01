import * as XLSX from 'xlsx';
import { rateSpreadsheetColumns } from '../data/schema';

const headerAliases = {
  employeeId: ['รหัสพนักงาน', 'หมายเลขพนักงาน', 'รหัสพนักงาน', 'employeeid', 'employee_id', 'employeecode', 'code'],
  firstName: ['ชื่อ', 'ชื่อจริง', 'ชื่อตัว', 'firstname', 'first_name', 'name'],
  // “หมายเหตุ” is the label in the supplied workbook. Older workbooks use
  // “นามสกุล” or “ชื่อสกุล” for the same third column.
  lastName: ['หมายเหตุ', 'นามสกุล', 'ชื่อสกุล', 'lastname', 'last_name'],
  department: ['แผนก', 'ชื่อชุด', 'department', 'dept'],
  position: ['ตำแหน่ง', 'position', 'jobtitle', 'job_title'],
  dailyRateYear69: ['ค่าแรงปี69', 'ค่าแรงปี2569', 'ค่าแรงปี2026', 'อัตราค่าแรง', 'dailyrateyear69', 'daily_rate_year_69'],
  travelRate: ['อัตราค่าเดินทาง', 'ค่าเดินทาง', 'ค่าพาหนะ', 'travelrate', 'travel_rate'],
  positionAllowance: ['ค่าตำแหน่ง', 'อัตราค่าตำแหน่ง', 'positionallowance', 'position_allowance'],
  specialPosition: ['ตำแหน่งพิเศษ', 'ค่าตำแหน่งพิเศษ', 'specialposition', 'special_position'],
  specialPositionAmount: ['ค่าแรงตำแหน่งพิเศษ', 'specialpositionamount', 'special_position_amount'],
  phoneAllowance: ['ค่าโทรศัพท์', 'ค่าโทร', 'phoneallowance', 'phone_allowance'],
  welfareSupport: ['สวัสดิการช่วยเหลือ', 'สวัสดิการ', 'welfaresupport', 'welfare_support'],
};

const normalizeHeader = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[\s_\-./()]/g, '');

const aliasMap = new Map(Object.entries(headerAliases).flatMap(([key, aliases]) => (
  aliases.map((alias) => [normalizeHeader(alias), key])
)));

const RATE_FIELD_KEYS = ['dailyRateYear69', 'travelRate', 'positionAllowance', 'specialPositionAmount', 'phoneAllowance', 'welfareSupport'];
const PAYROLL_SHEET_HEADERS = ['วันทำงานปกติ', 'รวมยอดสุทธิ', 'ค่าแรงปกติ'].map(normalizeHeader);

const textValue = (value) =>String(value ?? '').trim();

const numberValue = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = textValue(value).replace(/,/g, '');
  if (!text || /^[-–—]+$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
};

const mixedValue = (value) => {
  const number = numberValue(value);
  return number === undefined ? textValue(value) : number;
};

const findHeaderRow = (rows) => {
  let bestIndex = -1;
  let bestMatches = 0;

  rows.slice(0, 12).forEach((row, index) => {
    const matches = row.reduce((count, value) => count + (aliasMap.has(normalizeHeader(value)) ? 1 : 0), 0);
    if (matches > bestMatches) {
      bestIndex = index;
      bestMatches = matches;
    }
  });

  return bestMatches >= 2 ? bestIndex : -1;
};

const findSheetName = (workbook, requestedSheet) => {
  const requested = normalizeHeader(requestedSheet);
  return workbook.SheetNames.find((name) => normalizeHeader(name) === requested)
    || workbook.SheetNames[0];
};

const parseWorksheet = (worksheet, sheetName) => {
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
  const headerRowIndex = findHeaderRow(matrix);
  if (headerRowIndex < 0) return null;

  const columnMap = new Map();
  matrix[headerRowIndex].forEach((header, index) => {
    const key = aliasMap.get(normalizeHeader(header));
    if (key && !columnMap.has(key)) columnMap.set(key, index);
  });

  // Instruction sheets or unrelated sheets are ignored when one workbook
  // contains both DC and SUPPLY tabs.
  if (!columnMap.has('employeeId')) return null;
  // The full payroll workbook also has ไฟล์ทำค่าแรง / scan / social-security
  // sheets keyed by employee ID. Only rate sheets may update rates, otherwise
  // their ค่าเดินทาง (amount) columns overwrite the real อัตราค่าเดินทาง.
  if (!RATE_FIELD_KEYS.some((key) => columnMap.has(key))) return null;
  const headers = new Set(matrix[headerRowIndex].map(normalizeHeader));
  if (PAYROLL_SHEET_HEADERS.some((header) => headers.has(header))) return null;

  const getCell = (row, key) => row[columnMap.get(key)] ?? '';
  const records = [];
  const invalidRows = [];
  const invalidEmployeeIds = new Set();

  matrix.slice(headerRowIndex + 1).forEach((row, index) => {
    const employeeId = textValue(getCell(row, 'employeeId'));
    const excelRow = headerRowIndex + index + 2;
    if (!employeeId) return;

    const record = { employeeId };
    ['firstName', 'lastName', 'department', 'position', 'specialPosition'].forEach((key) => {
      if (!columnMap.has(key)) return;
      const value = textValue(getCell(row, key));
      if (value) record[key] = value;
    });
    ['dailyRateYear69', 'positionAllowance', 'specialPositionAmount', 'phoneAllowance', 'welfareSupport'].forEach((key) => {
      if (!columnMap.has(key)) return;
      const rawValue = getCell(row, key);
      if (textValue(rawValue) === '') return;
      const value = numberValue(rawValue);
      if (value === undefined) {
        invalidRows.push(`${sheetName} แถว ${excelRow}: ${key}`);
        invalidEmployeeIds.add(employeeId);
      }
      else record[key] = value;
    });
    if (columnMap.has('travelRate')) {
      const rawValue = getCell(row, 'travelRate');
      if (textValue(rawValue) !== '') record.travelRate = mixedValue(rawValue);
    }
    records.push(record);
  });

  return { records, invalidRows, invalidEmployeeIds: [...invalidEmployeeIds], sheetName, headerRow: headerRowIndex + 1 };
};

export const parseRateWorkbook = async (file, requestedSheet = 'DC') => {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: 'array',
    cellDates: false,
    raw: true,
  });
  if (!workbook.SheetNames.length) throw new Error('ไม่พบชีตในไฟล์ที่เลือก');

  const parsedSheets = workbook.SheetNames
    .map((sheetName) => parseWorksheet(workbook.Sheets[sheetName], sheetName))
    .filter(Boolean);
  const records = parsedSheets.flatMap((sheet) => sheet.records);
  if (!records.length) {
    throw new Error('ไม่พบหัวตารางที่รองรับ กรุณาใช้ไฟล์ template ของระบบ');
  }

  const seen = new Set();
  const duplicateEmployeeIds = [];
  records.forEach((record) => {
    const key = record.employeeId.toLowerCase();
    if (seen.has(key) && !duplicateEmployeeIds.includes(record.employeeId)) duplicateEmployeeIds.push(record.employeeId);
    seen.add(key);
  });

  return {
    records,
    duplicateEmployeeIds,
    invalidRows: parsedSheets.flatMap((sheet) => sheet.invalidRows),
    invalidEmployeeIds: [...new Set(parsedSheets.flatMap((sheet) => sheet.invalidEmployeeIds))],
    sheetName: findSheetName(workbook, requestedSheet),
    sheetNames: parsedSheets.map((sheet) => sheet.sheetName),
    headerRow: parsedSheets[0]?.headerRow || 1,
  };
};

const workbookRows = (rows) => [
  rateSpreadsheetColumns.map((column) => column.label),
  ...rows.map((row) => rateSpreadsheetColumns.map((column) => row[column.key] ?? '')),
];

export const createRateWorkbook = ({ rows = [], sheet = 'DC', template = false } = {}) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(workbookRows(template ? [] : rows));
  const lastRow = Math.max(rows.length + 1, 1);
  const headerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
    font: { bold: true, color: { rgb: '000000' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  rateSpreadsheetColumns.forEach((column, index) => {
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (headerCell) headerCell.s = headerStyle;
  });
  worksheet['!rows'] = [{ hpt: 25 }];
  worksheet['!cols'] = rateSpreadsheetColumns.map((column) => ({
    hidden: Boolean(column.hidden),
    wch: column.hidden ? 2 : Math.max(12, Math.min(24, column.label.length + 4)),
  }));
  const lastColumn = XLSX.utils.encode_col(rateSpreadsheetColumns.length - 1);
  worksheet['!autofilter'] = { ref: `A1:${lastColumn}${lastRow}` };
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet);

  if (template) {
    const instructions = XLSX.utils.aoa_to_sheet([
      ['คำแนะนำการนำเข้าอัตราค่าแรง'],
      ['กรอกข้อมูลในชีต ' + sheet + ' แล้วนำไฟล์กลับเข้าเมนู อัตราค่าแรง'],
      ['คอลัมน์ที่จำเป็น: รหัสพนักงาน'],
      ['ระบบจับคู่ข้อมูลเดิมด้วยรหัสพนักงาน และไม่ลบข้อมูลคอลัมน์ที่ไม่ได้ส่งมา'],
      ['รองรับอัตราค่าเดินทางเป็นตัวเลขหรือข้อความ เช่น พักแคมป์'],
    ]);
    instructions['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, instructions, 'คำแนะนำ');
  }

  return workbook;
};

const downloadWorkbook = (workbook, filename) => {
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadRateWorkbook = ({ rows = [], sheet = 'DC', template = false } = {}) => {
  const workbook = createRateWorkbook({ rows, sheet, template });
  const suffix = template ? 'template' : 'export';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadWorkbook(workbook, `CMG-Payroll-อัตราค่าแรง-${sheet}-${suffix}-${date}.xlsx`);
};
