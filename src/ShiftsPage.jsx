import { useCallback, useEffect, useState } from 'react';
import { deleteShift, saveShift, setDefaultShift, shiftHours, subscribeToShifts } from './lib/shifts';
import ShiftAssignTab from './ShiftAssignTab';

const ALL_PROJECTS = '__all__';
const EMPTY_FORM = { name: '', startTime: '07:30', endTime: '16:30', note: '' };

const runAction = async (action, success, onNotify) => {
  try {
    await action();
    if (success) onNotify(success);
    return true;
  } catch (actionError) {
    console.error('กะการทำงาน', actionError);
    onNotify(actionError?.code === 'permission-denied' ? 'บันทึกไม่สำเร็จ: Firebase ปฏิเสธสิทธิ์' : 'บันทึกไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ');
    return false;
  }
};

// กะการทำงาน: one table per project, stacked top to bottom. Each shift profile has a start/end
// time and can be flagged as the project's default, which every employee of the project uses
// until the ตารางการทำงาน menu assigns a different shift.
export default function ShiftsPage({ projects, rateRows, canEdit, onNotify }) {
  const [tab, setTab] = useState('profiles'); // 'profiles' | 'assign'
  const [adding, setAdding] = useState(false);
  const [counts, setCounts] = useState({}); // projectId -> number of shifts, filled by each ProjectShifts subscription
  const reportCount = useCallback((projectId, count) => setCounts((current) => (current[projectId] === count ? current : { ...current, [projectId]: count })), []);
  const add = async (projectId, form, makeDefault) => {
    const targets = projectId === ALL_PROJECTS ? projects.map((project) => project.id) : [projectId];
    const ok = await runAction(
      () => Promise.all(targets.map((id) => saveShift({ projectId: id, shift: form, makeDefault: makeDefault || !counts[id] }))),
      targets.length > 1 ? `เพิ่มกะให้ ${targets.length} โครงการแล้ว` : 'เพิ่มกะแล้ว',
      onNotify,
    );
    if (ok) setAdding(false);
  };
  const hasShifts = Object.values(counts).some(Boolean);
  const loaded = projects.every((project) => counts[project.id] !== undefined);
  return (
    <div className="page-content dataset-page">
      <section className="page-heading-row">
        <div>
          <div className="eyebrow">WORK SHIFTS</div>
          <h1>กะการทำงาน</h1>
          <p className="page-description">{tab === 'profiles'
            ? 'กำหนดโปรไฟล์กะ (เวลาเริ่ม–จบ) ของแต่ละโครงการ · กะที่ตั้งเป็น Default จะเป็นค่าเริ่มต้นของพนักงานทุกคนในโครงการนั้น'
            : 'เลือกการ์ดกะเพื่อเพิ่มพนักงานของโครงการนั้นเข้ากะ พร้อมช่วงวันที่ใช้งาน · พนักงานหนึ่งคนมีได้เพียงกะเดียวต่อวัน'}</p>
        </div>
        {tab === 'profiles' && canEdit && projects.length > 0 && <button type="button" className="primary-button" onClick={() => setAdding(true)}>＋ เพิ่มกะ</button>}
      </section>
      <div className="tabs" role="tablist" aria-label="แท็บกะการทำงาน">
        <button type="button" role="tab" aria-selected={tab === 'profiles'} className={`tab-button ${tab === 'profiles' ? 'active' : ''}`} onClick={() => setTab('profiles')}>โปรไฟล์กะ</button>
        <button type="button" role="tab" aria-selected={tab === 'assign'} className={`tab-button ${tab === 'assign' ? 'active' : ''}`} onClick={() => setTab('assign')}>ตั้งกะการทำงาน</button>
      </div>
      {tab === 'assign' ? <ShiftAssignTab projects={projects} rateRows={rateRows} canEdit={canEdit} onNotify={onNotify} /> : projects.length
        ? <>
            <div className="shift-grid">{projects.map((project) => <ProjectShifts key={project.id} project={project} canEdit={canEdit} onNotify={onNotify} onCount={reportCount} />)}</div>
            {loaded && !hasShifts && <div className="period-empty"><strong>ยังไม่มีกะการทำงาน</strong><span>กด “เพิ่มกะ” ด้านบนเพื่อเลือกโครงการและสร้างกะแรก</span></div>}
          </>
        : <div className="period-empty"><strong>ยังไม่มีโครงการ</strong><span>สร้างโครงการที่เมนูโครงการก่อน แล้วจึงเพิ่มกะการทำงาน</span></div>}
      {adding && <ShiftModal projects={projects} counts={counts} onClose={() => setAdding(false)} onSave={add} />}
    </div>
  );
}

function ProjectShifts({ project, canEdit, onNotify, onCount }) {
  const [shifts, setShifts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null); // null | shift
  const [error, setError] = useState('');

  useEffect(() => subscribeToShifts({
    projectId: project.id,
    onData: (data) => { setShifts(data); setLoaded(true); onCount(project.id, data.length); },
    onError: (loadError) => setError(loadError?.code === 'permission-denied' ? 'Firebase ปฏิเสธสิทธิ์การอ่านกะการทำงาน' : 'อ่านกะการทำงานไม่สำเร็จ'),
  }), [project.id, onCount]);

  const run = (action, success) => runAction(action, success, onNotify);

  const save = async (form) => {
    const ok = await run(() => saveShift({ projectId: project.id, shift: form, id: editing.id }), 'บันทึกกะแล้ว');
    if (ok) setEditing(null);
  };
  const makeDefault = (shift) => run(() => setDefaultShift({ projectId: project.id, shifts, shiftId: shift.id }), `ตั้ง “${shift.name}” เป็น Default ของโครงการ ${project.name} แล้ว`);
  const remove = (shift) => {
    if (!window.confirm(`ลบกะ “${shift.name}”?\n\nรายการตั้งกะการทำงานของพนักงานที่ใช้กะนี้จะถูกลบด้วย${shift.isDefault ? '\nนี่คือกะ Default ของโครงการ หลังลบจะไม่มี Default จนกว่าจะตั้งใหม่' : ''}`)) return;
    run(() => deleteShift({ projectId: project.id, shiftId: shift.id }), 'ลบกะแล้ว');
  };

  if (loaded && !shifts.length && !error) return null; // projects without shifts are not listed

  const visible = shifts;

  return (
    <section className="shift-register">
      <div className="shift-register-head">
        <h2>{project.name}{project.code ? ` · ${project.code}` : ''}<small>{shifts.length} กะ{shifts.some((shift) => shift.isDefault) ? '' : ' · ยังไม่ได้ตั้ง Default'}</small></h2>
      </div>
      {error && <div className="period-empty"><strong>{error}</strong></div>}
      <div className="table-scroll shift-scroll">
        <table className="data-table">
          <thead><tr><th>ชื่อกะ</th><th>เริ่ม</th><th>จบ</th><th>ชั่วโมง</th><th>สถานะ</th>{canEdit && <th>จัดการ</th>}</tr></thead>
          <tbody>
            {visible.map((shift) => (
              <tr key={shift.id}>
                <td className="shift-name">{shift.name}{shift.note && <small className="shift-note">{shift.note}</small>}</td>
                <td className="shift-time">{shift.startTime}</td>
                <td className="shift-time">{shift.endTime}</td>
                <td><span className="shift-pill">{shiftHours(shift.startTime, shift.endTime).toFixed(2)}</span></td>
                <td>{shift.isDefault ? <span className="shift-pill default">Default</span> : (canEdit ? <button type="button" className="text-button" onClick={() => makeDefault(shift)}>ตั้ง Default</button> : '—')}</td>
                {canEdit && <td><div className="shift-actions"><button type="button" className="text-button" onClick={() => setEditing(shift)}>แก้ไข</button><button type="button" className="text-button" onClick={() => remove(shift)}>ลบ</button></div></td>}
              </tr>
            ))}
            {!visible.length && <tr><td className="shift-empty" colSpan={canEdit ? 6 : 5}>ยังไม่มีกะการทำงานในโครงการนี้</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <ShiftModal shift={editing} projectName={project.name} onClose={() => setEditing(null)} onSave={save} />}
    </section>
  );
}

// Edit mode: `shift` + `projectName`. Add mode: `projects` + `counts` and a project picker.
function ShiftModal({ shift, projectName, projects, counts, onClose, onSave }) {
  const [form, setForm] = useState(shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, note: shift.note || '' } : EMPTY_FORM);
  const [projectId, setProjectId] = useState(projects?.[0]?.id || '');
  const isAll = projectId === ALL_PROJECTS;
  const isFirst = !shift && !isAll && !counts?.[projectId];
  const [wantDefault, setWantDefault] = useState(false);
  const asDefault = isFirst || wantDefault;
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const canSubmit = form.name.trim() && form.startTime && form.endTime && (shift || projectId);
  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    await (shift ? onSave(form) : onSave(projectId, form, asDefault));
    setBusy(false);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form className="editor-modal period-modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="shift-modal-title" onSubmit={submit}>
        <div className="modal-header">
          <div><div className="eyebrow">{shift ? projectName : 'WORK SHIFTS'}</div><h2 id="shift-modal-title">{shift ? 'แก้ไขกะการทำงาน' : 'เพิ่มกะการทำงาน'}</h2></div>
          <button type="button" className="close-button" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="period-modal-content">
          {!shift && <label className="period-name-field"><span>โครงการ</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>{projects.length > 1 && <option value={ALL_PROJECTS}>ทุกโครงการ ({projects.length})</option>}{projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.code ? ` · ${project.code}` : ''}</option>)}</select></label>}
          <label className="period-name-field"><span>ชื่อกะ</span><input autoFocus value={form.name} onChange={set('name')} placeholder="เช่น กะเช้า" required /></label>
          <div className="period-date-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="period-name-field"><span>เริ่ม</span><input type="time" value={form.startTime} onChange={set('startTime')} required /></label>
            <label className="period-name-field"><span>จบ</span><input type="time" value={form.endTime} onChange={set('endTime')} required /></label>
          </div>
          <label className="period-name-field"><span>หมายเหตุ</span><input value={form.note} onChange={set('note')} placeholder="ไม่บังคับ" /></label>
          {!shift && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={asDefault} onChange={(event) => setWantDefault(event.target.checked)} disabled={isFirst} /> ตั้งเป็น Default{isFirst ? ' (กะแรกเป็น Default อัตโนมัติ)' : isAll ? ' (โครงการที่ยังไม่มีกะจะเป็น Default อัตโนมัติ)' : ''}</label>}
          <p className="import-summary-file">ถ้าเวลาจบน้อยกว่าเวลาเริ่ม ระบบนับเป็นกะข้ามคืน</p>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>ยกเลิก</button><button type="submit" className="primary-button" disabled={busy || !canSubmit}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}
