import { useEffect, useMemo, useState } from 'react';
import {
  addShiftAssignments, deleteShiftAssignment, employeeKey, findConflicts, shiftHours,
  subscribeToShiftAssignments, subscribeToShifts, updateShiftAssignment,
} from './lib/shifts';

const SHIFT_COLORS = ['#7cb342', '#1f6bf0', '#f08c1f', '#8e44ad', '#0aa5a5', '#d6337f', '#5d6d7e', '#c0392b'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// ISO YYYY-MM-DD helpers. Dates are compared as strings, which sorts correctly for this format.
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseIso = (value) => { const [y, m, d] = String(value).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (value, days) => { const date = parseIso(value); date.setDate(date.getDate() + days); return iso(date); };
const daysBetween = (start, end) => Math.round((parseIso(end) - parseIso(start)) / 86400000) + 1;
const shortDate = (value) => { const date = parseIso(value); return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear() + 543).slice(-2)}`; };
const rangeLabel = (item) => (item.startDate === item.endDate ? shortDate(item.startDate) : `${shortDate(item.startDate)} – ${shortDate(item.endDate)}`);
const todayIso = () => iso(new Date());
const endOfMonthIso = () => { const now = new Date(); return iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)); };

const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
// The rates `project` field is a list joined with ", " (see syncMasterEmployees).
const rateProjectParts = (row) => String(row.project || '').split(/\s*,\s*/).filter(Boolean);
// A rate project entry belongs to a project when it equals the project's name or code, or contains
// either as a whole word ("J74", "J74 BUILDING GMTP", "BUILDING GMTP (J74)" all match J74 / BUILDING GMTP).
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const projectMatcher = (project) => {
  const patterns = [project.name, project.code].map(nameKey).filter(Boolean)
    .map((token) => new RegExp(`(^|[^a-z0-9฀-๿])${escapeRegExp(token)}($|[^a-z0-9฀-๿])`));
  return (part) => patterns.some((pattern) => pattern.test(nameKey(part)));
};
const shiftTime = (shift) => (shift ? `${shift.startTime}–${shift.endTime}` : '');
const statusOf = (item, today) => (item.endDate < today ? 'ended' : item.startDate > today ? 'upcoming' : 'active');
const STATUS_LABEL = { active: 'กำลังใช้', upcoming: 'ยังไม่เริ่ม', ended: 'สิ้นสุดแล้ว' };

const errorText = (error) => (error?.code === 'permission-denied' ? 'บันทึกไม่สำเร็จ: Firebase ปฏิเสธสิทธิ์' : 'บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ');

// ตั้งกะการทำงาน: shift cards grouped by project (projects without shifts are hidden). Opening a
// card lists the employees assigned to that shift with their date ranges; clicking a name expands
// that employee's month calendar. Conflicts are checked against every visible project so an
// employee never holds two shifts on the same day.
export default function ShiftAssignTab({ projects, rateRows = [], canEdit, onNotify }) {
  const [shiftsByProject, setShiftsByProject] = useState({});
  const [assignmentsByProject, setAssignmentsByProject] = useState({});
  const [selected, setSelected] = useState(null); // { projectId, shiftId }
  const [error, setError] = useState('');

  const projectKey = projects.map((project) => project.id).join('|');
  useEffect(() => {
    const onError = (loadError) => setError(loadError?.code === 'permission-denied' ? 'Firebase ปฏิเสธสิทธิ์การอ่านกะการทำงาน' : 'อ่านข้อมูลกะการทำงานไม่สำเร็จ');
    const unsubscribers = projects.flatMap((project) => [
      subscribeToShifts({ projectId: project.id, onData: (data) => setShiftsByProject((current) => ({ ...current, [project.id]: data })), onError }),
      subscribeToShiftAssignments({ projectId: project.id, onData: (data) => setAssignmentsByProject((current) => ({ ...current, [project.id]: data })), onError }),
    ]);
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  // Every shift across projects, keyed by id, with a stable per-project colour.
  const shiftsById = useMemo(() => {
    const map = new Map();
    projects.forEach((project) => (shiftsByProject[project.id] || []).forEach((shift, index) => map.set(shift.id, { ...shift, projectId: project.id, projectName: project.name, color: SHIFT_COLORS[index % SHIFT_COLORS.length] })));
    return map;
  }, [projects, shiftsByProject]);
  // Assignments whose shift was deleted are ignored everywhere.
  const allAssignments = useMemo(() => Object.values(assignmentsByProject).flat().filter((item) => shiftsById.has(item.shiftId)), [assignmentsByProject, shiftsById]);

  // Employees of each project from the rate table's `project` list (see projectMatcher).
  const employeesByProject = useMemo(() => {
    const result = {};
    projects.forEach((project) => {
      const matches = projectMatcher(project);
      const seen = new Map();
      rateRows.forEach((row) => {
        const key = employeeKey(row.employeeId);
        if (!key || seen.has(key)) return;
        if (!rateProjectParts(row).some(matches)) return;
        seen.set(key, { employeeId: String(row.employeeId).trim(), name: `${row.firstName || ''} ${row.lastName || ''}`.trim() || String(row.employeeId), position: row.position || '', department: row.teamName || row.department || '' });
      });
      result[project.id] = [...seen.values()].sort((a, b) => a.department.localeCompare(b.department, 'th') || a.employeeId.localeCompare(b.employeeId, 'th'));
    });
    return result;
  }, [projects, rateRows]);
  // Distinct project values in the rates, shown when a project matches nobody so the mismatch is visible.
  const rateProjectNames = useMemo(() => [...new Set(rateRows.flatMap(rateProjectParts).map((part) => part.trim().replace(/\s+/g, ' ')))].sort((a, b) => a.localeCompare(b, 'th')), [rateRows]);

  const loaded = projects.every((project) => shiftsByProject[project.id] !== undefined);
  const withShifts = projects.filter((project) => shiftsByProject[project.id]?.length);
  const current = selected && shiftsById.get(selected.shiftId);

  if (current) {
    const project = projects.find((item) => item.id === current.projectId);
    return (
      <ShiftAssignDetail
        project={project}
        shift={current}
        shiftsById={shiftsById}
        allAssignments={allAssignments}
        employees={employeesByProject[project.id] || []}
        rateProjectNames={rateProjectNames}
        canEdit={canEdit}
        onNotify={onNotify}
        onBack={() => setSelected(null)}
      />
    );
  }

  const today = todayIso();
  return (
    <div className="assign-page">
      {error && <div className="period-empty"><strong>{error}</strong></div>}
      {loaded && !withShifts.length && <div className="period-empty"><strong>ยังไม่มีกะการทำงาน</strong><span>สร้างกะที่แท็บ “โปรไฟล์กะ” ก่อน แล้วจึงตั้งกะให้พนักงาน</span></div>}
      {withShifts.map((project) => {
        const projectAssignments = (assignmentsByProject[project.id] || []).filter((item) => shiftsById.has(item.shiftId));
        return (
          <section key={project.id} className="assign-project">
            <h2>{project.name}{project.code ? ` · ${project.code}` : ''}<small>{shiftsByProject[project.id].length} กะ · พนักงานในโครงการ {(employeesByProject[project.id] || []).length} คน</small></h2>
            <div className="assign-card-grid">
              {shiftsByProject[project.id].map((shift) => {
                const items = projectAssignments.filter((item) => item.shiftId === shift.id);
                const people = new Set(items.map((item) => employeeKey(item.employeeId))).size;
                const activeNow = new Set(items.filter((item) => statusOf(item, today) === 'active').map((item) => employeeKey(item.employeeId))).size;
                const color = shiftsById.get(shift.id)?.color;
                return (
                  <button key={shift.id} type="button" className="assign-card" style={{ '--shift-color': color }} onClick={() => setSelected({ projectId: project.id, shiftId: shift.id })}>
                    <span className="assign-card-top"><strong>{shift.name}</strong>{shift.isDefault && <span className="assign-pill default">Default</span>}</span>
                    <span className="assign-card-time">{shiftTime(shift)} <small>· {shiftHours(shift.startTime, shift.endTime).toFixed(2)} ชม.</small></span>
                    <span className="assign-card-stats">
                      <span><b>{people}</b> คน</span>
                      <span><b>{items.length}</b> รายการ</span>
                      <span className="is-active"><b>{activeNow}</b> ใช้วันนี้</span>
                    </span>
                    <span className="assign-card-cta">จัดการพนักงาน →</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ShiftAssignDetail({ project, shift, shiftsById, allAssignments, employees, rateProjectNames, canEdit, onNotify, onBack }) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // assignment
  const [expanded, setExpanded] = useState(null); // assignment id whose calendar is open
  const today = todayIso();

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allAssignments
      .filter((item) => item.shiftId === shift.id)
      .filter((item) => !term || `${item.employeeId} ${item.employeeName} ${item.position} ${item.department}`.toLowerCase().includes(term))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.employeeId).localeCompare(String(b.employeeId), 'th'));
  }, [allAssignments, shift.id, search]);

  const remove = async (item) => {
    if (!window.confirm(`ลบ ${item.employeeName} ออกจากกะ “${shift.name}” (${rangeLabel(item)})?`)) return;
    try { await deleteShiftAssignment({ projectId: project.id, id: item.id }); onNotify('ลบรายการแล้ว'); } catch (removeError) { console.error(removeError); onNotify(errorText(removeError)); }
  };

  return (
    <div className="assign-page">
      <div className="assign-detail-head" style={{ '--shift-color': shift.color }}>
        <button type="button" className="secondary-button" onClick={onBack}>← กลับ</button>
        <div className="assign-detail-title">
          <div className="eyebrow">{project.name}{project.code ? ` · ${project.code}` : ''}</div>
          <h2><span className="assign-dot" />{shift.name} <small>{shiftTime(shift)} · {shiftHours(shift.startTime, shift.endTime).toFixed(2)} ชม.</small></h2>
        </div>
        <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาพนักงาน..." /></div>
        {canEdit && <button type="button" className="primary-button" onClick={() => setAdding(true)}>＋ เพิ่มพนักงาน</button>}
      </div>

      <section className="shift-register assign-register">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>รหัส</th><th>ชื่อ - สกุล</th><th>ตำแหน่ง / ชุด</th><th>เริ่ม</th><th>สิ้นสุด</th><th>วัน</th><th>สถานะ</th>{canEdit && <th>จัดการ</th>}</tr></thead>
            <tbody>
              {rows.map((item) => {
                const status = statusOf(item, today);
                const open = expanded === item.id;
                const employeeItems = allAssignments.filter((other) => employeeKey(other.employeeId) === employeeKey(item.employeeId));
                return [
                  <tr key={item.id} className={open ? 'is-open' : ''}>
                    <td className="shift-time">{item.employeeId}</td>
                    <td><button type="button" className="assign-name" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}><span className="assign-caret">{open ? '▾' : '▸'}</span>{item.employeeName}</button></td>
                    <td>{item.position}{item.department && <small className="shift-note">{item.department}</small>}</td>
                    <td>{shortDate(item.startDate)}</td>
                    <td>{shortDate(item.endDate)}</td>
                    <td><span className="shift-pill">{daysBetween(item.startDate, item.endDate)}</span></td>
                    <td><span className={`assign-status ${status}`}>{STATUS_LABEL[status]}</span></td>
                    {canEdit && <td><div className="shift-actions"><button type="button" className="text-button" onClick={() => setEditing(item)}>แก้ไข</button><button type="button" className="text-button" onClick={() => remove(item)}>ลบ</button></div></td>}
                  </tr>,
                  open && (
                    <tr key={`${item.id}-calendar`} className="assign-calendar-row">
                      <td colSpan={canEdit ? 8 : 7}>
                        <EmployeeCalendar
                          title={`${item.employeeName} · ${item.employeeId}`}
                          items={employeeItems.map((other) => {
                            const otherShift = shiftsById.get(other.shiftId);
                            return { id: other.id, startDate: other.startDate, endDate: other.endDate, color: otherShift.color, highlight: other.shiftId === shift.id, label: `${otherShift.name} ${shiftTime(otherShift)}${otherShift.projectId === project.id ? '' : ` · ${otherShift.projectName}`}` };
                          })}
                        />
                      </td>
                    </tr>
                  ),
                ];
              })}
              {!rows.length && <tr><td className="shift-empty" colSpan={canEdit ? 8 : 7}>{search ? 'ไม่พบพนักงานที่ค้นหา' : 'ยังไม่มีพนักงานในกะนี้ — กด “เพิ่มพนักงาน” เพื่อเริ่ม'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {adding && <AssignModal project={project} shift={shift} shiftsById={shiftsById} employees={employees} rateProjectNames={rateProjectNames} allAssignments={allAssignments} onNotify={onNotify} onClose={() => setAdding(false)} />}
      {editing && <EditRangeModal project={project} shift={shift} shiftsById={shiftsById} assignment={editing} allAssignments={allAssignments} onNotify={onNotify} onClose={() => setEditing(null)} />}
    </div>
  );
}

const conflictText = (conflicts, shiftsById) => conflicts.map((item) => `${shiftsById.get(item.shiftId)?.name || 'กะ'} ${rangeLabel(item)}`).join(', ');

function DateRangeFields({ startDate, endDate, onChange }) {
  return (
    <div className="assign-date-fields">
      <label className="period-name-field"><span>ใช้กะตั้งแต่วันที่</span><input type="date" value={startDate} onChange={(event) => onChange({ startDate: event.target.value, endDate: endDate && endDate < event.target.value ? event.target.value : endDate })} required /></label>
      <label className="period-name-field"><span>ถึงวันที่</span><input type="date" value={endDate} min={startDate} onChange={(event) => onChange({ startDate, endDate: event.target.value })} required /></label>
    </div>
  );
}

// Add employees to a shift: one list grouped by ชุด (department). Each group header selects the
// whole ชุด, each row selects one person. Anyone who already has a shift on any day of the chosen
// range is disabled with the conflicting shift named.
function AssignModal({ project, shift, shiftsById, employees, rateProjectNames = [], allAssignments, onNotify, onClose }) {
  const [range, setRange] = useState({ startDate: todayIso(), endDate: endOfMonthIso() });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const validRange = range.startDate && range.endDate && range.startDate <= range.endDate;

  const conflictsByEmployee = useMemo(() => {
    const map = new Map();
    if (!validRange) return map;
    employees.forEach((employee) => {
      const conflicts = findConflicts(allAssignments, { employeeId: employee.employeeId, ...range });
      if (conflicts.length) map.set(employeeKey(employee.employeeId), conflicts);
    });
    return map;
  }, [employees, allAssignments, range, validRange]);

  const available = (employee) => !conflictsByEmployee.has(employeeKey(employee.employeeId));
  const term = search.trim().toLowerCase();
  const visible = term ? employees.filter((employee) => `${employee.employeeId} ${employee.name} ${employee.position} ${employee.department}`.toLowerCase().includes(term)) : employees;
  const groups = useMemo(() => {
    const map = new Map();
    visible.forEach((employee) => { const key = employee.department || 'ไม่ระบุชุด'; map.set(key, [...(map.get(key) || []), employee]); });
    return [...map.entries()];
  }, [visible]);
  // ชุด groups start collapsed; a search shows every matching group expanded.
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const isOpen = (department) => Boolean(term) || openGroups.has(department);
  const toggleGroup = (department) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(department)) next.delete(department); else next.add(department);
    return next;
  });
  const allOpen = groups.length > 0 && groups.every(([department]) => isOpen(department));
  // Picks that became unavailable after a date change are dropped from the count and the save.
  const chosen = employees.filter((employee) => picked.has(employeeKey(employee.employeeId)) && available(employee));

  const toggle = (list, on) => setPicked((current) => {
    const next = new Set(current);
    list.filter(available).forEach((employee) => (on ? next.add(employeeKey(employee.employeeId)) : next.delete(employeeKey(employee.employeeId))));
    return next;
  });

  const submit = async (event) => {
    event.preventDefault();
    if (!validRange || !chosen.length || busy) return;
    setBusy(true);
    try {
      await addShiftAssignments({ projectId: project.id, shiftId: shift.id, employees: chosen, ...range });
      onNotify(`เพิ่ม ${chosen.length} คนเข้ากะ “${shift.name}” แล้ว`);
      onClose();
    } catch (saveError) {
      console.error(saveError);
      onNotify(errorText(saveError));
      setBusy(false);
    }
  };

  const visibleAvailable = visible.filter(available);
  const allVisiblePicked = visibleAvailable.length > 0 && visibleAvailable.every((employee) => picked.has(employeeKey(employee.employeeId)));

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form className="editor-modal assign-modal" role="dialog" aria-modal="true" aria-labelledby="assign-modal-title" onSubmit={submit}>
        <div className="modal-header">
          <div><div className="eyebrow">{project.name} · {shift.name} {shiftTime(shift)}</div><h2 id="assign-modal-title">เพิ่มพนักงานเข้ากะ</h2></div>
          <button type="button" className="close-button" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="assign-modal-content">
          <DateRangeFields {...range} onChange={setRange} />
          <div className="assign-pick-toolbar">
            <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหารหัส ชื่อ ตำแหน่ง ชุด..." /></div>
            {!term && groups.length > 1 && <button type="button" className="text-button" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(groups.map(([department]) => department)))}>{allOpen ? 'พับทุกชุด' : 'กางทุกชุด'}</button>}
            <label className="assign-check"><input type="checkbox" checked={allVisiblePicked} disabled={!visibleAvailable.length} onChange={(event) => toggle(visible, event.target.checked)} /> เลือกทั้งหมดที่ว่าง ({visibleAvailable.length})</label>
          </div>
          <div className="assign-pick-list">
            {!employees.length && (
              <div className="shift-empty">
                <strong>ไม่พบพนักงานของโครงการ “{project.name}”{project.code ? ` (${project.code})` : ''} ในตารางอัตราค่าแรง</strong>
                <p>ระบบจับคู่จากคอลัมน์สถานะโครงการของพนักงาน โดยต้องมีชื่อหรือรหัสโครงการนี้อยู่ · แก้ชื่อ/รหัสโครงการที่เมนูโครงการให้ตรงกับข้อมูลพนักงาน</p>
                {rateProjectNames.length
                  ? <p>ค่าโครงการที่มีในตารางอัตราค่าแรง: {rateProjectNames.slice(0, 20).join(', ')}{rateProjectNames.length > 20 ? ` และอีก ${rateProjectNames.length - 20} ค่า` : ''}</p>
                  : <p>ตารางอัตราค่าแรงยังไม่มีข้อมูลสถานะโครงการ — กด Sync ข้อมูลที่เมนูอัตราค่าแรง</p>}
              </div>
            )}
            {employees.length > 0 && !groups.length && <div className="shift-empty">ไม่พบพนักงานที่ค้นหา</div>}
            {groups.map(([department, list]) => {
              const free = list.filter(available);
              const pickedCount = free.filter((employee) => picked.has(employeeKey(employee.employeeId))).length;
              return (
                <div key={department} className="assign-group">
                  <div className="assign-group-head">
                    <input type="checkbox" aria-label={`เลือกทั้งชุด ${department}`} checked={free.length > 0 && pickedCount === free.length} ref={(input) => { if (input) input.indeterminate = pickedCount > 0 && pickedCount < free.length; }} disabled={!free.length} onChange={(event) => toggle(list, event.target.checked)} />
                    <button type="button" className="assign-group-toggle" aria-expanded={isOpen(department)} onClick={() => toggleGroup(department)}>
                      <span className="assign-caret">{isOpen(department) ? '▾' : '▸'}</span>
                      <strong>{department}</strong><small>ว่าง {free.length}/{list.length} คน{pickedCount ? ` · เลือก ${pickedCount}` : ''}</small>
                    </button>
                  </div>
                  {isOpen(department) && list.map((employee) => {
                    const key = employeeKey(employee.employeeId);
                    const conflicts = conflictsByEmployee.get(key);
                    return (
                      <label key={key} className={`assign-person ${conflicts ? 'is-blocked' : ''}`}>
                        <input type="checkbox" checked={!conflicts && picked.has(key)} disabled={Boolean(conflicts)} onChange={(event) => toggle([employee], event.target.checked)} />
                        <span className="assign-person-id">{employee.employeeId}</span>
                        <span className="assign-person-name">{employee.name}<small>{employee.position}</small></span>
                        {conflicts && <span className="assign-person-conflict">ติดกะ {conflictText(conflicts, shiftsById)}</span>}
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-footer">
          <span className="assign-footer-count">{validRange ? <>เลือก <b>{chosen.length}</b> คน · {daysBetween(range.startDate, range.endDate)} วัน</> : 'ช่วงวันที่ไม่ถูกต้อง'}</span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="primary-button" disabled={busy || !validRange || !chosen.length}>{busy ? 'กำลังบันทึก...' : `เพิ่ม ${chosen.length || ''} คน`}</button>
        </div>
      </form>
    </div>
  );
}

function EditRangeModal({ project, shift, shiftsById, assignment, allAssignments, onNotify, onClose }) {
  const [range, setRange] = useState({ startDate: assignment.startDate, endDate: assignment.endDate });
  const [busy, setBusy] = useState(false);
  const validRange = range.startDate && range.endDate && range.startDate <= range.endDate;
  const conflicts = validRange ? findConflicts(allAssignments, { employeeId: assignment.employeeId, ...range, exceptId: assignment.id }) : [];
  const submit = async (event) => {
    event.preventDefault();
    if (!validRange || conflicts.length || busy) return;
    setBusy(true);
    try {
      await updateShiftAssignment({ projectId: project.id, id: assignment.id, ...range });
      onNotify('บันทึกช่วงวันที่แล้ว');
      onClose();
    } catch (saveError) {
      console.error(saveError);
      onNotify(errorText(saveError));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form className="editor-modal period-modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="assign-edit-title" onSubmit={submit}>
        <div className="modal-header">
          <div><div className="eyebrow">{shift.name} {shiftTime(shift)}</div><h2 id="assign-edit-title">{assignment.employeeName}</h2></div>
          <button type="button" className="close-button" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="period-modal-content">
          <DateRangeFields {...range} onChange={setRange} />
          {conflicts.length > 0 && <p className="assign-error">ช่วงวันที่ซ้อนกับ {conflictText(conflicts, shiftsById)} — พนักงานหนึ่งคนมีได้เพียงกะเดียวต่อวัน</p>}
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>ยกเลิก</button><button type="submit" className="primary-button" disabled={busy || !validRange || conflicts.length > 0}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}

// Month calendar (Sunday first) where every range is drawn as a bar spanning its days, split at
// week boundaries and stacked into lanes so bars on the same week never overlap.
function EmployeeCalendar({ title, items }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return { y: now.getFullYear(), m: now.getMonth() }; });
  const shiftMonth = (delta) => setMonth(({ y, m }) => { const date = new Date(y, m + delta, 1); return { y: date.getFullYear(), m: date.getMonth() }; });
  const today = todayIso();

  const weeks = useMemo(() => {
    const first = new Date(month.y, month.m, 1);
    const last = new Date(month.y, month.m + 1, 0);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const result = [];
    for (let cursor = iso(start); cursor <= iso(last); cursor = addDays(cursor, 7)) {
      const days = Array.from({ length: 7 }, (_, index) => addDays(cursor, index));
      const weekEnd = days[6];
      const segments = items
        .filter((item) => item.startDate <= weekEnd && item.endDate >= cursor)
        .map((item) => {
          const from = item.startDate < cursor ? cursor : item.startDate;
          const to = item.endDate > weekEnd ? weekEnd : item.endDate;
          return { ...item, col: daysBetween(cursor, from) - 1, span: daysBetween(from, to), continuesLeft: item.startDate < cursor, continuesRight: item.endDate > weekEnd };
        })
        .sort((a, b) => a.col - b.col || b.span - a.span);
      const laneEnds = [];
      segments.forEach((segment) => {
        let lane = laneEnds.findIndex((end) => end < segment.col);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = segment.col + segment.span - 1;
        segment.lane = lane;
      });
      result.push({ start: cursor, days, segments, lanes: laneEnds.length });
    }
    return result;
  }, [month, items]);

  return (
    <div className="assign-calendar">
      <div className="assign-calendar-head">
        <strong>{title}</strong>
        <div className="assign-calendar-nav">
          <button type="button" className="secondary-button" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อน">‹</button>
          <span>{THAI_MONTHS[month.m]} {month.y + 543}</span>
          <button type="button" className="secondary-button" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">›</button>
          <button type="button" className="text-button" onClick={() => { const now = new Date(); setMonth({ y: now.getFullYear(), m: now.getMonth() }); }}>เดือนนี้</button>
        </div>
      </div>
      <div className="assign-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      {weeks.map((week) => (
        <div key={week.start} className="assign-calendar-week" style={{ gridTemplateRows: `28px repeat(${week.lanes}, 26px) minmax(10px, 1fr)` }}>
          {week.days.map((day, index) => {
            const date = parseIso(day);
            const outside = date.getMonth() !== month.m;
            return (
              <div key={day} className={`assign-calendar-day ${outside ? 'is-outside' : ''} ${day === today ? 'is-today' : ''}`} style={{ gridColumn: index + 1, gridRow: '1 / -1' }}>
                <span>{date.getDate()}</span>
              </div>
            );
          })}
          {week.segments.map((segment) => (
            <div
              key={`${segment.id}-${week.start}`}
              className={`assign-calendar-bar ${segment.continuesLeft ? 'cont-left' : ''} ${segment.continuesRight ? 'cont-right' : ''} ${segment.highlight ? '' : 'is-other'}`}
              style={{ gridColumn: `${segment.col + 1} / span ${segment.span}`, gridRow: segment.lane + 2, '--shift-color': segment.color }}
              title={`${segment.label} · ${rangeLabel(segment)}`}
            >
              {segment.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
