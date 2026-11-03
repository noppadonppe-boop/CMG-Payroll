export const wageTimeError = (value) => {
  if (!value.timeRequest) return '';
  if (value.uploadPending) return 'กรุณารออัปโหลดไฟล์ให้เสร็จ';
  if (!value.attachments?.some((file) => file.url && file.path)) return 'กรุณาแนบไฟล์ประกอบคำขอ';
  if (!value.timeReason?.trim()) return 'กรุณาใส่เหตุผลที่ขอเพิ่มเวลา';
  if (!value.timeInEnabled && !value.timeOutEnabled) return 'กรุณาเลือกเข้า หรือออก อย่างน้อย 1 อย่าง';
  if (['timeIn', 'timeOut'].some((field) => value[field + 'Enabled'] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value[field] || ''))) return 'กรุณาระบุเวลาที่เลือกให้ครบ';
  return '';
};

export const wageTypeData = (value) => ({
  attachments: value.timeRequest ? (value.attachments || []) : [],
  special: Boolean(value.special), wageDrop: Boolean(value.wageDrop), timeRequest: Boolean(value.timeRequest),
  timeReason: value.timeRequest ? (value.timeReason || '').trim() : '',
  timeInEnabled: Boolean(value.timeRequest && value.timeInEnabled), timeOutEnabled: Boolean(value.timeRequest && value.timeOutEnabled),
  timeIn: value.timeRequest && value.timeInEnabled ? value.timeIn : '',
  timeOut: value.timeRequest && value.timeOutEnabled ? value.timeOut : '',
});
