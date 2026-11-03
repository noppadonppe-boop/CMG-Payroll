import { isCampTravel } from './schema';

const payrollRow = (values) => ({
  id: values.id,
  sheet: values.sheet,
  sequence: values.sequence,
  employeeId: values.employeeId,
  firstName: values.firstName,
  lastName: values.lastName || '',
  department: values.department,
  position: values.position,
  normalDays: values.normalDays ?? 12,
  overtime15: values.overtime15 ?? 0,
  overtime2Sunday: values.overtime2Sunday ?? 0,
  holidayHours: values.holidayHours ?? 0,
  travelFormula: values.travelFormula ?? values.normalDays ?? 12,
  dailyRate: values.dailyRate,
  travelRate: values.travelRate,
  positionAllowance: values.positionAllowance ?? 0,
  phoneAllowance: values.phoneAllowance ?? 0,
  overtimeRate15: values.overtimeRate15 ?? Number(values.dailyRate || 0) / 8 * 1.5,
  regularWage: values.regularWage ?? Number(values.dailyRate || 0) * Number(values.normalDays ?? 12),
  overtime15Amount: values.overtime15Amount ?? 0,
  overtime2SundayAmount: values.overtime2SundayAmount ?? 0,
  holidayHoursAmount: values.holidayHoursAmount ?? 0,
  positionPhoneTotal: values.positionPhoneTotal ?? (values.positionAllowance ?? 0) + (values.phoneAllowance ?? 0),
  travelAmount: isCampTravel(values.travelRate) ? 0 : (values.travelAmount ?? 0),
  contractWork: values.contractWork ?? 0,
  wageDrop: values.wageDrop ?? 0,
  deduction: values.deduction ?? 0,
  socialSecurity: values.socialSecurity ?? 0,
  netTotal: values.netTotal ?? values.dailyRate * (values.normalDays ?? 12),
  note: values.note || '',
});

const dcRates = [
  { id: 'rate-dc-0001', sheet: 'DC', employeeId: 'DC0001', firstName: 'นาง ดุจดาว', lastName: 'อิ่มแสน', department: 'DC-J01', position: 'แม่บ้าน', dailyRateYear69: 440, travelRate: 50, positionAllowance: 0, phoneAllowance: 0, welfareSupport: 215, status: 'ใช้งาน' },
  { id: 'rate-dc-0003', sheet: 'DC', employeeId: 'DC0003', firstName: 'นาย ไพรรัตน์', lastName: 'คุณขอนยาง', department: 'DC-J75', position: 'Supervisor', dailyRateYear69: 750, travelRate: 30, positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ใช้งาน' },
  { id: 'rate-dc-0006', sheet: 'DC', employeeId: 'DC0006', firstName: 'นาง รัตดา', lastName: 'คุณขอนยาง', department: 'Dชุดเกรียงศักดิ์', position: 'ผู้ช่วยช่าง', dailyRateYear69: 410, travelRate: 30, positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ใช้งาน' },
  { id: 'rate-dc-0012', sheet: 'DC', employeeId: 'DC0012', firstName: 'นาย ประมวล', lastName: 'ไชยโยธา', department: 'Dชุดประมวล', position: 'Foreman', dailyRateYear69: 730, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ใช้งาน' },
  { id: 'rate-dc-0020', sheet: 'DC', employeeId: 'DC0020', firstName: 'น.ส. นิตยา', lastName: 'มาลาพันธ์', department: 'Dชุดประมวล', position: 'ผู้ช่วยช่าง', dailyRateYear69: 474, travelRate: 'พักแคมป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ใช้งาน' },
];

const supplyRates = [
  { id: 'rate-sp-06848', sheet: 'SUPPLY', employeeId: 'SP06848', firstName: 'Mr.SAI AUNG TUN', lastName: '', department: 'SชุดSAI AUNG TUN-NLS', position: 'Foreman', dailyRateYear69: 650, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ออก' },
  { id: 'rate-sp-06849', sheet: 'SUPPLY', employeeId: 'SP06849', firstName: 'Mr.AUNG MYO KHANT', lastName: '', department: 'SชุดSAI AUNG TUN-NLS', position: 'ช่างไม้/ช่างปูน', dailyRateYear69: 530, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ออก' },
  { id: 'rate-sp-06850', sheet: 'SUPPLY', employeeId: 'SP06850', firstName: 'Mr.HEIN THU AUNG', lastName: '', department: 'SชุดSAI AUNG TUN-NLS', position: 'ช่างไม้/ช่างปูน', dailyRateYear69: 530, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ออก' },
  { id: 'rate-sp-06851', sheet: 'SUPPLY', employeeId: 'SP06851', firstName: 'Mr.KHIN ZAW OO', lastName: '', department: 'SชุดSAI AUNG TUN-NLS', position: 'ช่างไม้/ช่างปูน', dailyRateYear69: 530, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ออก' },
  { id: 'rate-sp-06855', sheet: 'SUPPLY', employeeId: 'SP06855', firstName: 'Miss.TEREZA', lastName: '', department: 'SชุดSAI AUNG TUN-NLS', position: 'ผู้ช่วยช่าง', dailyRateYear69: 450, travelRate: 'พักแค้มป์', positionAllowance: 0, phoneAllowance: 0, welfareSupport: 0, status: 'ออก' },
];

const payrollDC = [
  payrollRow({ id: 'payroll-dc-1', sheet: 'DC', sequence: 1, employeeId: 'DC0001', firstName: 'นาง ดุจดาว', lastName: 'อิ่มแสน', department: 'DC-J01', position: 'แม่บ้าน', dailyRate: 440, travelRate: 50, regularWage: 5280, travelAmount: 600, netTotal: 5880 }),
  payrollRow({ id: 'payroll-dc-2', sheet: 'DC', sequence: 2, employeeId: 'DC0003', firstName: 'นาย ไพรรัตน์', lastName: 'คุณขอนยาง', department: 'DC-J75', position: 'Supervisor', dailyRate: 750, travelRate: 30, regularWage: 9000, travelAmount: 360, netTotal: 9360 }),
  payrollRow({ id: 'payroll-dc-3', sheet: 'DC', sequence: 3, employeeId: 'DC0006', firstName: 'นาง รัตดา', lastName: 'คุณขอนยาง', department: 'Dชุดเกรียงศักดิ์', position: 'ผู้ช่วยช่าง', dailyRate: 410, travelRate: 30, regularWage: 4920, travelAmount: 360, netTotal: 5280 }),
];

const payrollSupply = [
  payrollRow({ id: 'payroll-supply-1', sheet: 'SUPPLY', sequence: 1, employeeId: 'SP06848', firstName: 'Mr.SAI AUNG TUN', department: 'SชุดSAI AUNG TUN-NLS', position: 'Foreman', dailyRate: 650, travelRate: 'พักแค้มป์', regularWage: 7800, netTotal: 7800 }),
  payrollRow({ id: 'payroll-supply-2', sheet: 'SUPPLY', sequence: 2, employeeId: 'SP06849', firstName: 'Mr.AUNG MYO KHANT', department: 'SชุดSAI AUNG TUN-NLS', position: 'ช่างไม้/ช่างปูน', dailyRate: 530, travelRate: 'พักแค้มป์', regularWage: 6360, netTotal: 6360 }),
  payrollRow({ id: 'payroll-supply-3', sheet: 'SUPPLY', sequence: 3, employeeId: 'SP06850', firstName: 'Mr.HEIN THU AUNG', department: 'SชุดSAI AUNG TUN-NLS', position: 'ช่างไม้/ช่างปูน', dailyRate: 530, travelRate: 'พักแค้มป์', regularWage: 6360, overtime15: 2, overtime15Amount: 198.75, netTotal: 6558.75 }),
];

export const mockDatasets = {
  rates: { DC: dcRates, SUPPLY: supplyRates },
  payroll: { DC: payrollDC, SUPPLY: payrollSupply, ซอ: payrollSupply.map((row, index) => ({ ...row, id: `payroll-ซอ-${index + 1}`, sheet: 'ซอ' })) },
};
