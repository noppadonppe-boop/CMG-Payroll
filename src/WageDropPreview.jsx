import { useEffect, useState } from 'react';
import { subscribeToBiotimeAttendance } from './lib/biotime';
import { buildEmployeeReport, formatReportDate } from './lib/biotimeReport';

export { priorWagePeriod } from './lib/wageDropRequest';

export function WageDropPreview({ period, requests, rates, shiftFor, holidayFor, onConfirm, onCancel }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setRecords(null);
    setError('');
    return subscribeToBiotimeAttendance({ periodId: period.id, onData: setRecords, onError: () => setError('อ่านข้อมูล Biotime ไม่สำเร็จ กรุณาปิดแล้วลองใหม่') });
  }, [period.id]);
  const request = requests[index];
  const key = (id) => String(id || '').trim().toLowerCase();
  const saved = records?.find((item) => key(item.employeeId) === key(request.employeeId));
  const rate = rates.find((item) => key(item.employeeId) === key(request.employeeId)) || {};
  const record = { ...rate, ...saved, employeeId: request.employeeId, startDate: period.startDate, endDate: period.endDate, days: saved?.days || [] };
  const rows = buildEmployeeReport(record, shiftFor, holidayFor).rows.filter((row) => !row.leadIn);
  const confirm = async () => {
    if (saving) return;
    if (index < requests.length - 1) { setIndex(index + 1); return; }
    setSaving(true);
    try { await onConfirm(); } catch { setError('บันทึกคำขอไม่สำเร็จ กรุณาลองใหม่'); setSaving(false); }
  };
  return <div className="modal-backdrop wage-drop-backdrop">
    <section className="editor-modal wage-drop-modal" role="dialog" aria-modal="true" aria-labelledby="wage-drop-title">
      <div className="modal-header"><div><h2 id="wage-drop-title">การลงเวลา Biotime · ขอค่าแรงตก</h2><p>งวดก่อนหน้า: {period.name} · {index + 1}/{requests.length} คน · วันที่ขอ {formatReportDate(request.date)}</p></div><button type="button" className="close-button" disabled={saving} onClick={onCancel}>×</button></div>
      <div className="wage-drop-body">
        {!records && !error && <p role="status">กำลังโหลดการลงเวลา…</p>}
        {error && <p className="wage-entry-error" role="alert">{error}</p>}
        {records && <>
          {!saved && <p className="wage-drop-notice">ยังไม่มีข้อมูล Biotime ที่บันทึกไว้สำหรับพนักงานคนนี้ในงวดก่อนหน้า</p>}
          <div className="table-scroll"><table className="data-table wage-drop-table"><thead><tr>{['รหัส', 'ชื่อ', 'สกุล', 'แผนก', 'วันที่', 'วันทำงาน', 'เวลาเข้า', 'เวลาออก', 'วันปกติ (วัน)', 'OT1.5 (ชม.)', 'วันอาทิตย์ (ชม.)', 'วันหยุดบริษัท (ชม.)'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.date} className={row.date === request.date ? 'wage-drop-selected' : ''}><td>{request.employeeId}</td><td>{record.firstName || '-'}</td><td>{record.lastName || '-'}</td><td>{record.department || '-'}</td><td>{formatReportDate(row.date)}</td><td>{row.weekday}</td><td>{row.timeIn || '-'}</td><td>{row.timeOut || '-'}</td><td>{saved && Number(row.normal) ? Number(row.normal).toFixed(1) : '-'}</td>{['ot', 'sunday', 'holiday'].map((field) => <td key={field}>{saved && Number(row[field]) ? Number(row[field]).toFixed(1) : '-'}</td>)}</tr>)}</tbody>
          </table></div>
        </>}
      </div>
      <div className="modal-footer"><button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>ยกเลิก</button>{index > 0 && <button type="button" className="secondary-button" disabled={saving} onClick={() => setIndex(index - 1)}>คนก่อนหน้า</button>}<button type="button" className="primary-button" disabled={!records || saving} onClick={confirm}>{saving ? 'กำลังบันทึก…' : index < requests.length - 1 ? 'ดูคนถัดไป' : 'ยืนยันคำขอ'}</button></div>
    </section>
  </div>;
}
