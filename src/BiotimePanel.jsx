import { nextDate } from './lib/biotimeScans';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fetchBiotimePunches, saveBiotimeAttendance, saveBiotimeOverride, subscribeToBiotimeAttendance } from './lib/biotime';
import { attachLeadIn, buildEmployeeReport, formatReportDate, leadInStartDate, parseTime } from './lib/biotimeReport';

const PAGE_SIZE = 50;
const employeeKey = (value) => String(value || '').trim().toLowerCase();
const dateLabel = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '-');

// Fetch jobs live outside React state so they keep running (and their result stays
// readable) after the modal is closed or the user leaves this tab.
const jobs = new Map();
const jobListeners = new Set();
const setJob = (periodId, job) => { jobs.set(periodId, job); jobListeners.forEach((listener) => listener()); };
const subscribeJobs = (listener) => { jobListeners.add(listener); return () => jobListeners.delete(listener); };

async function runJob({ period, chosen }) {
  const base = { startedAt: Date.now(), total: chosen.length };
  setJob(period.id, { ...base, status: 'running' });
  try {
    // Also fetch the days before the period that the first Sunday's 6-day check needs.
    const leadIn = leadInStartDate(period.startDate, period.endDate);
    const { punches, schedules } = await fetchBiotimePunches({ startDate: leadIn || period.startDate, endDate: nextDate(period.endDate) });
    const result = await saveBiotimeAttendance({ period, employees: chosen, punches, schedules, leadInStartDate: leadIn });
    setJob(period.id, { ...base, status: 'done', finishedAt: Date.now(), message: `บันทึกแล้ว ${result.employees} คน · ${result.days} วันที่มีการสแกน (จากสแกนทั้งหมด ${punches.length} ครั้ง)` });
  } catch (loadError) {
    setJob(period.id, { ...base, status: 'error', finishedAt: Date.now(), message: loadError.message || 'ดึงข้อมูล Biotime ไม่สำเร็จ' });
  }
}

// Biotime tab of a payroll period. "ดึงและบันทึกลง Firebase" opens a modal to pick employees
// from the period's payroll table, then fetches the Biotime scan times for the
// period's Start–End dates, saves it to Firebase and shows the saved rows.
export default function BiotimePanel({ period, employees, previousByEmployee, shiftFor, holidayFor, wageEntries, PaginationControls }) {
  const [saved, setSaved] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [pickSearch, setPickSearch] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [dismissedAt, setDismissedAt] = useState(0);
  const job = useSyncExternalStore(subscribeJobs, () => jobs.get(period?.id));
  const loading = job?.status === 'running';
  const notice = job?.status === 'done' && job.startedAt !== dismissedAt ? job.message : '';
  const jobError = job?.status === 'error' && job.startedAt !== dismissedAt ? job.message : '';
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(null);
  const goBack = useCallback(() => setDetailId(null), []);
  const canLoad = Boolean(period?.id && period?.startDate && period?.endDate);

  useEffect(() => {
    setSaved([]);
    setError('');
    return subscribeToBiotimeAttendance({
      periodId: period?.id,
      onData: setSaved,
      onError: (subscribeError) => setError(subscribeError?.code === 'permission-denied' ? 'Firebase ปฏิเสธสิทธิ์การอ่านข้อมูล Biotime' : 'อ่านข้อมูล Biotime จาก Firebase ไม่สำเร็จ'),
    });
  }, [period?.id]);

  const savedById = useMemo(() => new Map(saved.map((item) => [employeeKey(item.employeeId), item])), [saved]);
  const pickList = useMemo(() => {
    const term = pickSearch.trim().toLowerCase();
    return term ? employees.filter((employee) => `${employee.employeeId} ${employee.name}`.toLowerCase().includes(term)) : employees;
  }, [employees, pickSearch]);
  const chosen = useMemo(() => employees.filter((employee) => selected.has(employee.employeeId)), [employees, selected]);
  const allVisibleChecked = pickList.length > 0 && pickList.every((employee) => selected.has(employee.employeeId));

  const toggle = (employeeId) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(employeeId)) next.delete(employeeId); else next.add(employeeId);
    return next;
  });
  const selectVisible = (checked) => setSelected((current) => {
    const next = new Set(current);
    pickList.forEach((employee) => (checked ? next.add(employee.employeeId) : next.delete(employee.employeeId)));
    return next;
  });
  const closeModal = () => setModalOpen(false);

  const load = () => {
    if (loading) return;
    runJob({ period, chosen });
    setSelected(new Set());
    setModalOpen(false);
  };

  const rows = useMemo(() => [...saved].sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId))), [saved]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rows.filter((row) => `${row.employeeId} ${row.name}`.toLowerCase().includes(term)) : rows;
  }, [rows, search]);
  useEffect(() => setPage(1), [search, saved]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(offset, offset + PAGE_SIZE);

  const detail = detailId ? saved.find((item) => item.employeeId === detailId) : null;
  if (detail) {
    // Older saved records lack name/department/position, so fill gaps from the period's payroll row.
    const live = employees.find((employee) => employeeKey(employee.employeeId) === employeeKey(detail.employeeId)) || {};
    const record = attachLeadIn({ ...detail, ...Object.fromEntries(['name', 'firstName', 'lastName', 'department', 'position'].map((key) => [key, detail[key] || live[key] || ''])) }, previousByEmployee?.get(employeeKey(detail.employeeId)));
    return <BiotimeEmployeeReport periodId={period?.id} record={record} shiftFor={shiftFor} holidayFor={holidayFor} wageEntries={wageEntries} onBack={goBack} />;
  }

  return (
    <>
      <section className="data-panel">
        <div className="data-panel-toolbar">
          <div><h2>การลงเวลา Biotime</h2><p>เวลาเข้า–ออกตามกะ · กรองสแกนซ้ำภายใน 2 ชั่วโมง{canLoad ? ` · ${dateLabel(period.startDate)} – ${dateLabel(period.endDate)}` : ''} · ข้อมูลที่บันทึกไว้ใน Firebase</p></div>
          <div className="toolbar-controls">
            <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัสหรือชื่อ..." /></div>
            <button type="button" className="primary-button" onClick={() => setModalOpen(true)} disabled={!canLoad}>ดึงและบันทึกลง Firebase</button>
          </div>
        </div>
        {!canLoad && <div className="period-empty"><strong>งวดนี้ยังไม่มีวันที่เริ่มต้น/สิ้นสุด</strong></div>}
        {error && <div className="period-empty"><strong>ดึงข้อมูลไม่สำเร็จ</strong><span>{error}</span></div>}
        {loading && (
          // Centred over the screen but click-through, so the sidebar and other menus stay usable.
          <div className="bt-loading-overlay" role="status" aria-live="polite">
            <div className="bt-loading-card">
              <span className="bt-hourglass" aria-hidden="true">⏳</span>
              <strong>กำลังดึงเวลา {job.total} คน อยู่เบื้องหลัง</strong>
              <span>ไปเมนูอื่นหรือสลับแท็บได้ · กลับมาดูผลลัพธ์ที่นี่เมื่อเสร็จ</span>
            </div>
          </div>
        )}
        {jobError && <div className="period-empty"><strong>ดึงข้อมูลไม่สำเร็จ</strong><span>{jobError}</span> <button type="button" className="text-button" onClick={() => setDismissedAt(job.startedAt)}>ปิด</button></div>}
        {notice && <div className="table-summary"><span>✅ {notice}</span> <button type="button" className="text-button" onClick={() => setDismissedAt(job.startedAt)}>ปิด</button></div>}
        <div className="table-summary"><span>ทั้งหมด <strong>{filtered.length}</strong> คน · กดที่ชื่อเพื่อดูรายงานรายบุคคล · วันทำงานปกติ/OT ถูกนำไปใช้ในตารางค่าแรงอัตโนมัติ</span></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>No.</th><th>Employee ID</th><th>ชื่อ-นามสกุล</th><th>วันที่มีการสแกน</th><th>ดึงข้อมูลเมื่อ</th></tr></thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr key={row.employeeId}>
                  <td>{offset + index + 1}</td>
                  <td>{row.employeeId}</td>
                  <td><button type="button" className="text-button" onClick={() => setDetailId(row.employeeId)}>{row.name || row.employeeId}</button></td>
                  <td>{(row.days || []).length} วัน</td>
                  <td>{row.fetchedAt ? new Date(row.fetchedAt).toLocaleString('th-TH') : '-'}</td>
                </tr>
              ))}
              {!pageRows.length && <tr><td colSpan={5}>ยังไม่มีข้อมูลที่บันทึกไว้ · กด “ดึงและบันทึกลง Firebase” เพื่อเลือกพนักงาน</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls currentPage={currentPage} pageCount={pageCount} totalCount={filtered.length} onPageChange={setPage} />
      </section>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
          <section className="editor-modal import-summary-modal" role="dialog" aria-modal="true" aria-labelledby="biotime-pick-title">
            <div className="modal-header">
              <div><div className="eyebrow">BIOTIME</div><h2 id="biotime-pick-title">เลือกพนักงานที่จะดึงเวลา</h2><p className="import-summary-file">รายชื่อจากตารางค่าแรงของงวดนี้ ({employees.length} คน) · ดึงวันที่ {dateLabel(period?.startDate)} – {dateLabel(period?.endDate)}</p></div>
              <button type="button" className="close-button" onClick={closeModal}>×</button>
            </div>
            <div className="import-summary-content">
              <div className="search-box" style={{ width: '100%', marginBottom: 10 }}><span>⌕</span><input value={pickSearch} onChange={(event) => setPickSearch(event.target.value)} placeholder="ค้นหารหัสหรือชื่อ..." /></div>
              {employees.length ? (
                <div className="table-scroll" style={{ maxHeight: '42vh', minHeight: 0 }}>
                  <table className="data-table">
                    <thead><tr><th><input type="checkbox" checked={allVisibleChecked} onChange={(event) => selectVisible(event.target.checked)} aria-label="เลือกทั้งหมดที่แสดง" /></th><th>Employee ID</th><th>ชื่อ-นามสกุล</th><th>สถานะ</th></tr></thead>
                    <tbody>
                      {pickList.map((employee) => {
                        const record = savedById.get(employeeKey(employee.employeeId));
                        return (
                          <tr key={employee.employeeId}>
                            <td><input type="checkbox" checked={selected.has(employee.employeeId)} onChange={() => toggle(employee.employeeId)} aria-label={`เลือก ${employee.employeeId}`} /></td>
                            <td>{employee.employeeId}</td>
                            <td>{employee.name || '-'}</td>
                            <td>{record ? `ดึงแล้ว ${new Date(record.fetchedAt).toLocaleString('th-TH')}` : 'ยังไม่ได้ดึง'}</td>
                          </tr>
                        );
                      })}
                      {!pickList.length && <tr><td colSpan={4}>ไม่พบรายชื่อ</td></tr>}
                    </tbody>
                  </table>
                </div>
              ) : <div className="period-empty"><strong>ยังไม่มีพนักงานในตารางค่าแรงของงวดนี้</strong><span>เพิ่มรายการในแท็บตารางค่าแรงก่อน</span></div>}
              {loading && <p className="confirm-text">กำลังดึงข้อมูลอยู่เบื้องหลัง · รอให้เสร็จก่อนเริ่มรอบใหม่</p>}
            </div>
            <div className="modal-footer">
              <span className="import-summary-file" style={{ marginRight: 'auto' }}>เลือกแล้ว {chosen.length} คน</span>
              <button type="button" className="secondary-button" onClick={closeModal}>ปิด</button>
              <button type="button" className="primary-button" onClick={load} disabled={loading || !chosen.length}>{`ดึงและบันทึกลง Firebase (${chosen.length} คน)`}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const num = (value) => (value ? value.toFixed(2) : '-');

// เวลาเข้า/เวลาออก cell: the Biotime time with a checkbox after it. Ticking opens an editor
// (24-hour time, "17:00" or "17.00", plus a reason) with a save icon; saving stores it, returns to
// the normal view and the time is used for the calculation instead of the scan. Unticking goes
// back to the Biotime time. The reason has a fixed width; hover shows it in full.
function TimeOverrideCell({ raw, override, onChange }) {
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const parsed = parseTime(time);
  const canSave = Boolean(parsed && reason.trim());
  const startEdit = () => { setTime(override?.time || raw || ''); setReason(override?.reason || ''); setEditing(true); };
  const save = () => {
    if (!canSave) return;
    if (parsed !== override?.time || reason.trim() !== (override?.reason || '')) onChange({ time: parsed, reason: reason.trim() });
    setEditing(false);
  };
  const untick = () => { setEditing(false); if (override) onChange(null); };
  const onKeyDown = (event) => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <td className="bt-time-override">
        <div className="bt-time-cell">
          <input
            className={`bt-time-input${parsed ? '' : ' is-invalid'}`}
            value={time}
            maxLength={5}
            inputMode="decimal"
            placeholder="HH:MM"
            autoFocus
            title={`เวลาจาก Biotime: ${raw || '-'} · ใส่เวลา 24 ชม. เช่น 17:00 หรือ 17.00`}
            onChange={(event) => setTime(event.target.value.replace(/[^0-9.:]/g, ''))}
            onKeyDown={onKeyDown}
          />
          <input type="checkbox" checked onChange={untick} title="ยกเลิก ใช้เวลาจาก Biotime" aria-label="ยกเลิกเวลาที่แก้" />
          <input
            className={`bt-reason-input${reason.trim() ? '' : ' is-empty'}`}
            value={reason}
            placeholder="เหตุผล..."
            title={reason.trim() || 'ระบุเหตุผลที่แก้เวลา'}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="bt-icon-button bt-save-button" onClick={save} disabled={!canSave} title={canSave ? 'บันทึก' : parsed ? 'ระบุเหตุผลก่อนบันทึก' : 'ใส่เวลาให้ถูกต้อง เช่น 17:00'} aria-label="บันทึก">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
          </button>
        </div>
      </td>
    );
  }
  if (!override) {
    return (
      <td>
        <div className="bt-time-cell">
          <strong>{raw || '-'}</strong>
          <input type="checkbox" checked={false} onChange={startEdit} title="แก้เวลาเอง" aria-label="แก้เวลาเอง" />
        </div>
      </td>
    );
  }
  return (
    <td className="bt-time-override">
      <div className="bt-time-cell">
        <strong className="bt-time-value" onClick={startEdit} title={`แก้ไขเอง · เวลาจาก Biotime: ${raw || '-'} · คลิกเพื่อแก้ไข`}>{override.time}</strong>
        <input type="checkbox" checked onChange={untick} title="ยกเลิก ใช้เวลาจาก Biotime" aria-label="ยกเลิกเวลาที่แก้" />
        <span className="bt-reason-text" title={override.reason || 'ไม่ได้ระบุเหตุผล'}>{override.reason || '-'}</span>
      </div>
    </td>
  );
}

// Per-employee report in the layout of the HR sample sheet: one line per date of the period.
const WAGE_REQUEST_STATUS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };

// Requests from Admin ลงค่าแรง of this employee, grouped by date, as short alert texts.
function wageAlertsByDate(wageEntries, employeeId) {
  const map = new Map();
  (wageEntries || []).filter((entry) => employeeKey(entry.employeeId) === employeeKey(employeeId)).forEach((entry) => {
    const types = [(entry.special ?? (!entry.wageDrop && !entry.timeRequest)) && 'ลงค่าตำแหน่งพิเศษ', entry.wageDrop && 'ค่าแรงตก', entry.timeRequest && ('ขอเพิ่มเวลา ' + [entry.timeInEnabled && ('เข้า ' + entry.timeIn), entry.timeOutEnabled && ('ออก ' + entry.timeOut)].filter(Boolean).join(' / ') + ' เหตุผล: ' + entry.timeReason)].filter(Boolean).join(' + ');
    const text = `${types} (${WAGE_REQUEST_STATUS[entry.status || 'approved'] || entry.status})`;
    const current = map.get(entry.date) || { texts: [], approved: true };
    map.set(entry.date, { texts: [...current.texts, text], approved: current.approved && (entry.status || 'approved') === 'approved' });
  });
  return map;
}

function BiotimeEmployeeReport({ periodId, record, shiftFor, holidayFor, wageEntries, onBack }) {
  const wageAlerts = useMemo(() => wageAlertsByDate(wageEntries, record.employeeId), [wageEntries, record.employeeId]);
  const { rows, totals } = useMemo(() => buildEmployeeReport(record, shiftFor, holidayFor), [record, shiftFor, holidayFor]);
  const [saveError, setSaveError] = useState('');
  const saveOverride = (date, field, value) => {
    setSaveError('');
    saveBiotimeOverride({ periodId, employeeId: record.employeeId, date, field, value })
      .catch((overrideError) => setSaveError(overrideError?.code === 'permission-denied' ? 'Firebase ปฏิเสธสิทธิ์การบันทึกเวลาที่แก้ไข' : overrideError?.message || 'บันทึกเวลาที่แก้ไขไม่สำเร็จ'));
  };
  const overrideCount = rows.filter((row) => !row.leadIn && (row.overrideIn || row.overrideOut)).length;
  // Clicking the empty background around the report acts like "← รายชื่อ"; clicks inside the
  // report, on controls, or on the sidebar/header do nothing extra.
  const panelRef = useRef(null);
  useEffect(() => {
    const handle = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.isConnected) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('button, a, input, select, textarea, label, aside, nav, header, [role="dialog"], .modal-backdrop')) return;
      onBack();
    };
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, [onBack]);
  const assignedDays = rows.filter((row) => row.shiftName && !row.leadIn).length;
  const sundaysAsNormal = rows.filter((row) => row.sundayAsNormal).length;
  const unverified = rows.some((row) => row.sundayUnverified);
  return (
    <section className="data-panel biotime-report-panel" ref={panelRef}>
      <div className="data-panel-toolbar">
        <div>
          <button type="button" className="secondary-button period-back-button" onClick={onBack}>← รายชื่อ</button>
          <h2>{record.employeeId} · {record.name || '-'}</h2>
          <p>{record.department || '-'} · {record.position || '-'} · {formatReportDate(record.startDate)} – {formatReportDate(record.endDate)} · วันหยุดบริษัทยังไม่มีข้อมูลปฏิทิน{assignedDays ? ` · ${record.scheduleSource === 'biotime' ? 'ใช้ตารางกะ Biotime' : 'ใช้กะเดิม · กรุณาดึง Biotime ใหม่'} ${assignedDays} วัน` : ''}</p>
          {sundaysAsNormal > 0 && <p style={{ color: '#b45309', fontWeight: 600 }}>⚠ วันอาทิตย์ {sundaysAsNormal} วันคิดเป็นวันทำงานปกติ เพราะไม่ได้ทำงานต่อเนื่องครบ 6 วันก่อนหน้า</p>}
          {record.leadInStartDate && <p style={{ color: '#6b7280' }}>แถวสีเทา = วันก่อนงวด ({formatReportDate(record.leadInStartDate)} ขึ้นไป{record.leadInSource === 'previous' ? ' · จากข้อมูลงวดก่อนหน้า' : ''}) แสดงเพื่อตรวจการทำงานต่อเนื่อง 6 วันของวันอาทิตย์แรก · ไม่นำมาคำนวณ</p>}
          {unverified && <p style={{ color: '#6b7280' }}>⚠ ไม่มีข้อมูลวันก่อนงวด · กด “ดึงและบันทึกลง Firebase” ใหม่เพื่อดึงวันก่อนงวดมาตรวจด้วย</p>}
          <p style={{ color: '#6b7280' }}>ติ๊ก ☐ หลังเวลาเข้า/ออกเพื่อแก้เวลาเอง (24 ชม. เช่น 17:00 หรือ 17.00) พร้อมเหตุผล แล้วกดไอคอนบันทึก · คลิกเวลาที่แก้แล้วเพื่อแก้อีกครั้ง · เอาติ๊กออกเพื่อกลับไปใช้เวลา Biotime · เวลาที่แก้จะใช้คำนวณแทนเวลาจาก Biotime{overrideCount ? ` · แก้ไขแล้ว ${overrideCount} วัน` : ''}</p>
          {saveError && <p style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ {saveError}</p>}
        </div>
      </div>
      <div className="table-scroll" style={{ maxHeight: 'none' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>หมายเลขพนักงาน</th><th>ชื่อจริง</th><th>นามสกุล</th><th>แผนก</th><th>ตำแหน่ง</th><th>วันที่</th><th>วันทำงาน</th>
              <th>เช็คอิน</th><th>เช็คเอาท์</th><th>อุปกรณ์[เข้า]</th><th>อุปกรณ์[ออก]</th><th>เวลาเข้า</th><th>เวลาออก</th>
              <th>วันปกติ (วัน)</th><th>OT1.5 (ชม.)</th><th>วันอาทิตย์ (ชม.)</th><th>วันหยุดบริษัท (ชม.)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date} className={row.leadIn ? 'biotime-lead-in-row' : wageAlerts.has(row.date) ? (wageAlerts.get(row.date).approved ? 'bt-wage-row approved' : 'bt-wage-row') : undefined} style={row.leadIn || wageAlerts.has(row.date) ? undefined : row.holidayName ? { background: '#e8f7ee' } : row.sundayAsNormal ? { background: '#fff4d6' } : row.isSunday ? { background: '#fde4e4' } : undefined}>
                <td>{record.employeeId}</td><td>{record.firstName || '-'}</td><td>{record.lastName || '-'}</td><td>{record.department || '-'}</td><td>{record.position || '-'}</td>
                <td>{formatReportDate(row.date)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {row.weekday}
                  {row.leadIn && <small title="วันก่อนเริ่มงวด แสดงเพื่อตรวจการทำงานต่อเนื่อง 6 วันของวันอาทิตย์เท่านั้น" className="biotime-lead-in-tag">ก่อนงวด · ไม่นำมาคำนวณ</small>}
                  {!row.leadIn && wageAlerts.get(row.date)?.texts.map((text) => <small key={text} className={`bt-wage-alert${wageAlerts.get(row.date).approved ? ' approved' : ''}`} title={text}>🔔 {text}</small>)}
                  {row.holidayName && <small title={`วันหยุดบริษัท: ${row.holidayName}`} style={{ marginLeft: 6, color: '#15803d', fontSize: 10, fontWeight: 600 }}>🎌 {row.holidayName}</small>}
                  {row.sundayAsNormal && <small title="ไม่ได้ทำงานต่อเนื่องครบ 6 วันก่อนวันอาทิตย์ จึงคิดเป็นวันทำงานปกติ" style={{ marginLeft: 6, color: '#b45309', fontSize: 10, fontWeight: 600 }}>⚠ คิดเป็นวันปกติ (ทำไม่ครบ 6 วัน)</small>}
                  {row.sundayUnverified && <small title="ไม่มีข้อมูลสแกนของวันก่อนเริ่มงวด จึงตรวจสอบการทำงานต่อเนื่อง 6 วันได้ไม่ครบ" style={{ marginLeft: 6, color: '#6b7280', fontSize: 10 }}>⚠ ตรวจ 6 วันไม่ครบ (ก่อนงวด)</small>}
                </td>
                <td title={row.shiftName ? `กะ ${row.shiftName} (ตั้งกะการทำงาน) · เข้างานสายได้ ${row.lateGraceMinutes || 0} นาที` : undefined}>{row.shiftStart}{row.lateGraceMinutes > 0 && <small style={{ display: 'block' }}>สายได้ {row.lateGraceMinutes} นาที</small>}</td><td>{row.shiftEnd}</td><td>{row.deviceIn || '-'}</td><td>{row.deviceOut || '-'}</td>
                {row.leadIn ? (
                  <><td><strong>{row.timeIn || '-'}</strong></td><td><strong>{row.timeOut || '-'}</strong></td></>
                ) : (
                  <>
                    <TimeOverrideCell raw={row.rawTimeIn} override={row.overrideIn} onChange={(value) => saveOverride(row.date, 'timeIn', value)} />
                    <TimeOverrideCell raw={row.rawTimeOut} override={row.overrideOut} onChange={(value) => saveOverride(row.date, 'timeOut', value)} />
                  </>
                )}
                <td>{row.normal.toFixed(1)}</td><td>{num(row.ot)}</td><td>{num(row.sunday)}</td><td>{num(row.holiday)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={13}><strong>Statistics</strong></td><td><strong>{totals.normal.toFixed(1)}</strong></td><td><strong>{totals.ot.toFixed(2)}</strong></td><td><strong>{totals.sunday.toFixed(2)}</strong></td><td><strong>{totals.holiday.toFixed(2)}</strong></td></tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
