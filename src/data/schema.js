const commonPayrollColumns = [
  { key: 'sequence', label: 'ลำดับ', type: 'number', editable: false },
  { key: 'employeeId', label: 'หมายเลขพนักงาน', type: 'text' },
  { key: 'firstName', label: 'ชื่อจริง', type: 'text' },
  { key: 'lastName', label: 'นามสกุล', type: 'text' },
  { key: 'department', label: 'แผนก', type: 'text' },
  { key: 'position', label: 'ตำแหน่ง', type: 'text' },
  { key: 'normalDays', label: 'วันทำงานปกติ', type: 'number' },
  { key: 'overtime15', label: 'OT 1.5', type: 'number' },
  { key: 'overtime2Sunday', label: 'OT 2 อาทิตย์', type: 'number' },
  { key: 'holidayHours', label: 'OT ชม.วันหยุด', type: 'number' },
  { key: 'dailyRate', label: 'อัตราค่าแรง', type: 'currency', editable: false },
  { key: 'travelRate', label: 'ค่าเดินทาง', type: 'mixed', editable: false },
  { key: 'positionAllowance', label: 'ค่าตำแหน่งพิเศษ', type: 'currency', editable: false },
  { key: 'phoneAllowance', label: 'ค่าโทรศัพท์', type: 'currency', editable: false },
  { key: 'overtimeRate15', label: 'อัตรา OT 1.5', type: 'currency', editable: false },
  { key: 'overtime2SundayAmount', label: 'ยอด OT 2 อาทิตย์', type: 'currency', editable: false },
  { key: 'holidayHoursAmount', label: 'ยอด OT ชม.วันหยุด', type: 'currency', editable: false },
  { key: 'contractWork', label: 'งานเหมา', type: 'currency', editable: false },
  { key: 'wageDrop', label: 'ค่าแรงตก', type: 'currency' },
  { key: 'deduction', label: 'หักเงิน', type: 'currency' },
  { key: 'socialSecurity', label: 'ประกันสังคม', type: 'currency', editable: false },
  { key: 'netTotal', label: 'รวมยอดสุทธิ', type: 'currency', editable: false },
  { key: 'note', label: 'หมายเหตุ', type: 'text' },
];

const rateColumns = [
  { key: 'employeeId', label: 'รหัสพนักงาน', type: 'text' },
  { key: 'firstName', label: 'ชื่อ', type: 'text' },
  { key: 'lastName', label: 'นามสกุล', type: 'text' },
  { key: 'department', label: 'แผนก', type: 'text' },
  { key: 'teamName', label: 'ชื่อชุด', type: 'text', editable: false },
  { key: 'position', label: 'ตำแหน่ง', type: 'text' },
  { key: 'project', label: 'โครงการ', type: 'text', editable: false },
  { key: 'dailyRateYear69', label: 'ค่าแรงปี 69', type: 'currency' },
  { key: 'travelRate', label: 'อัตราค่าเดินทาง', type: 'mixed' },
  {
    key: 'specialPosition',
    label: 'ตำแหน่งพิเศษ',
    type: 'special-position',
    amountKey: 'specialPositionAmount',
  },
  { key: 'phoneAllowance', label: 'ค่าโทรศัพท์', type: 'currency' },
  { key: 'welfareSupport', label: 'สวัสดิการช่วยเหลือ', type: 'currency' },
  { key: 'status', label: 'สถานะ', type: 'text' },
];

const supplyRateColumns = rateColumns.filter((column) => !['phoneAllowance', 'welfareSupport'].includes(column.key));

// The rate workbook used by the payroll team has a compact, fixed layout. Keep
// Keep the workbook layout in the same order as the source Excel file.
export const rateSpreadsheetColumns = [
  { key: 'employeeId', label: 'รหัสพนักงาน', type: 'text' },
  { key: 'firstName', label: 'ชื่อ', type: 'text' },
  { key: 'lastName', label: 'นามสกุล', type: 'text' },
  { key: 'department', label: 'แผนก', type: 'text' },
  { key: 'position', label: 'ตำแหน่ง', type: 'text' },
  { key: 'dailyRateYear69', label: 'ค่าแรงปี69', type: 'currency' },
  { key: 'travelRate', label: 'อัตราค่าเดินทาง', type: 'mixed' },
  { key: 'specialPosition', label: 'ตำแหน่งพิเศษ', type: 'text' },
  { key: 'specialPositionAmount', label: 'ค่าแรงตำแหน่งพิเศษ', type: 'currency' },
  { key: 'phoneAllowance', label: 'ค่าโทรศัพท์', type: 'currency' },
  { key: 'welfareSupport', label: 'สวัสดิการช่วยเหลือ', type: 'currency' },
];

export const sourceCatalog = {
  payroll: {
    id: 'payroll',
    label: 'สรุปค่าแรง',
    sourceFile: 'ไฟล์ค่าแรง มีวันหยุด ปี 2569.xlsx',
    collection: 'CMG-Payroll/root/payroll',
    tabs: {
      DC: {
        label: 'DC',
        sourceSheet: 'DC ',
        headerRow: 6,
        dataStartRow: 7,
        sourceRows: 68,
        columns: commonPayrollColumns,
        description: 'ค่าแรงพนักงานรายวันของชุด DC พร้อมรายการ OT และเงินหัก',
      },
      SUPPLY: {
        label: 'SUPPLY',
        sourceSheet: 'SUPPLY',
        headerRow: 6,
        dataStartRow: 7,
        sourceRows: 68,
        columns: commonPayrollColumns,
        description: 'ค่าแรงพนักงานรายวันของชุด SUPPLY',
      },
      ซอ: {
        label: 'ซอ',
        sourceSheet: 'ซอ',
        headerRow: 6,
        dataStartRow: 7,
        sourceRows: 133,
        columns: commonPayrollColumns,
        description: 'ค่าแรงพนักงานรายวันของชุด ซอ',
      },
    },
  },
  rates: {
    id: 'rates',
    label: 'อัตราค่าแรง',
    sourceFile: 'อัตราค่าแรง.xlsx',
    collection: 'CMG-Payroll/root/rates',
    tabs: {
      DC: {
        label: 'DC',
        sourceSheet: 'DC',
        headerRow: 2,
        dataStartRow: 3,
        sourceRows: 314,
        columns: rateColumns,
        description: 'ทะเบียนพนักงานและอัตราค่าแรงของชุด DC',
      },
      SUPPLY: {
        label: 'SUPPLY',
        sourceSheet: 'SUPPLY',
        headerRow: 1,
        dataStartRow: 2,
        sourceRows: 440,
        columns: supplyRateColumns,
        description: 'ทะเบียนพนักงานและอัตราค่าแรงของชุด SUPPLY',
      },
    },
  },
};

export const menuItems = [
  { id: 'projects', label: 'โครงการ', shortLabel: 'โครงการ', group: 'database' },
  { id: 'rates', label: 'อัตราค่าแรง', shortLabel: 'อัตรา', group: 'database' },
  { id: 'holidays', label: 'วันหยุดบริษัท', shortLabel: 'วันหยุด', group: 'database' },
  { id: 'payroll', label: 'สรุปค่าแรง', shortLabel: 'ค่าแรง', group: 'global' },
  { id: 'adminWage', label: 'Admin ลงค่าแรง', shortLabel: 'ลงค่าแรง', group: 'wage' },
  { id: 'overview', label: 'ภาพรวม', shortLabel: 'ภาพรวม' },
];

// Shown at the bottom-left of the sidebar and only for MasterAdmin.
export const usersMenuItem = { id: 'users', label: 'จัดการผู้ใช้งาน', shortLabel: 'ผู้ใช้งาน' };

const thaiNumberFormatter = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

export const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return thaiNumberFormatter.format(number);
};

export const formatCell = (value, type = 'text') => {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'currency') return formatCurrency(value);
  if (type === 'number') return formatCurrency(value);
  return String(value);
};

export const isCampTravel = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return normalized.includes('พักแคม') || normalized.includes('พักแค้ม') || normalized.includes('camp');
};

export const effectiveTravelAmount = (row = {}) => (
  isCampTravel(row.travelRate) ? 0 : Number(row.travelAmount || 0)
);

export const effectiveNetTotal = (row = {}) => {
  const storedTotal = Number(row.netTotal || 0);
  if (!isCampTravel(row.travelRate) || row.netTotal === undefined || row.netTotal === '') return storedTotal;

  // If an old/imported row already included a travel amount, remove it from
  // the displayed/calculated total when the employee stays at camp.
  return storedTotal - Number(row.travelAmount || 0);
};

export const isNameRecentlyChanged = (row = {}, field, now = Date.now()) => {
  if (!['firstName', 'lastName'].includes(field)) return false;
  const changedAt = Date.parse(row.nameChangedAt || '');
  const age = now - changedAt;
  if (!Number.isFinite(changedAt) || age < 0 || age >= 24 * 60 * 60 * 1000) return false;
  return !Array.isArray(row.nameChangedFields)
    || row.nameChangedFields.length === 0
    || row.nameChangedFields.includes(field);
};
