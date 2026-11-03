import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext';
import { ROLES, ROLE_LABELS, STATUS_LABELS, displayNameOf, initialOf, toRoleList } from './constants';
import { navigate } from './router';
import { PROJECT_STATUSES, addProjectsFromRates, archiveProject, createProject, pendingProjectNames, updateProject } from './projectService';
import { setUserStatus, updateUserByAdmin } from './userService';

export const DROPDOWN_LAYER = 10010;

export function Avatar({ profile, className = '' }) {
  const [failed, setFailed] = useState(false);
  const photoURL = profile?.photoURL;
  useEffect(() => setFailed(false), [photoURL]);
  return (
    <span className={`user-avatar ${className}`}>
      {photoURL && !failed
        ? <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initialOf(profile)}
    </span>
  );
}

const RoleChips = ({ roles }) => (
  <span className="role-chips">{toRoleList(roles).map((role) => <span key={role} className={`role-chip ${role === 'MasterAdmin' ? 'master' : ''}`}>{role}</span>)}</span>
);

// ----------------------------------------------------------- MultiSelect -----

// The menu is portalled to <body> with a fixed position so it is never clipped
// by a scrolling modal, and sits on layer 10010 above every dialog.
export function MultiSelect({ options, value = [], onChange, placeholder = 'เลือก...', disabled = false, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const measure = () => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const labelOf = (item) => options.find((option) => option.value === item)?.label || item;
  const toggle = (item) => onChange(value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item]);

  return (
    <div className="multi-select">
      <button type="button" ref={triggerRef} className="multi-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((current) => !current)}>
        <span className="multi-select-value">
          {value.length ? value.map((item) => <span key={item} className="multi-select-tag">{labelOf(item)}</span>) : <span className="multi-select-placeholder">{placeholder}</span>}
        </span>
        <span className="multi-select-caret">▾</span>
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} className="multi-select-menu" role="listbox" aria-multiselectable="true" style={{ position: 'fixed', zIndex: DROPDOWN_LAYER, top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) }}>
          {options.length ? options.map((option) => (
            <label key={option.value} className="multi-select-option">
              <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} />
              <span>{option.label}</span>
            </label>
          )) : <div className="multi-select-empty">ไม่มีตัวเลือก</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ------------------------------------------------------ profile surfaces -----

export function SidebarProfileCard() {
  const { userProfile } = useAuth();
  return (
    <div className="sidebar-profile-card">
      <Avatar profile={userProfile} className="large" />
      <div className="sidebar-profile-text">
        <strong>{displayNameOf(userProfile)}</strong>
        <small>{userProfile?.position || userProfile?.email}</small>
        <RoleChips roles={userProfile?.role} />
      </div>
    </div>
  );
}

export function TopbarProfileMenu({ onEditProfile }) {
  const { userProfile, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !ref.current?.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="profile-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)} title={displayNameOf(userProfile)}>
        <Avatar profile={userProfile} />
      </button>
      {open && (
        <div className="profile-menu-popover" role="menu" style={{ zIndex: DROPDOWN_LAYER }}>
          <div className="profile-menu-head"><strong>{displayNameOf(userProfile)}</strong><small>{userProfile?.email}</small></div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onEditProfile(); }}>อัปเดตโปรไฟล์</button>
          <button type="button" role="menuitem" className="danger" onClick={signOut}>ออกจากระบบ</button>
        </div>
      )}
    </div>
  );
}

export function ProfileModal({ onClose, onNotify }) {
  const { userProfile, updateMyProfile } = useAuth();
  const [form, setForm] = useState({ firstName: userProfile.firstName || '', lastName: userProfile.lastName || '', position: userProfile.position || '' });
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateMyProfile(form);
      onNotify('อัปเดตโปรไฟล์แล้ว');
      onClose();
    } catch (error) {
      console.error('ไม่สามารถอัปเดตโปรไฟล์', error);
      onNotify('อัปเดตโปรไฟล์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="editor-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={save}>
        <div className="modal-header">
          <div><div className="eyebrow">โปรไฟล์ของฉัน</div><h2 id="profile-title">อัปเดตข้อมูลส่วนตัว</h2></div>
          <button type="button" className="close-button" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="profile-modal-body">
          <div className="profile-modal-identity"><Avatar profile={userProfile} className="large" /><div><strong>{userProfile.email}</strong><RoleChips roles={userProfile.role} /></div></div>
          <div className="editor-grid two">
            <label><span>ชื่อ</span><input required value={form.firstName} onChange={set('firstName')} /></label>
            <label><span>นามสกุล</span><input required value={form.lastName} onChange={set('lastName')} /></label>
            <label className="full-field"><span>ตำแหน่ง</span><input value={form.position} onChange={set('position')} /></label>
          </div>
          <small className="profile-hint">สิทธิ์และโครงการที่เข้าถึงได้ ผู้ดูแลระบบ (MasterAdmin) เป็นผู้กำหนด</small>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>ยกเลิก</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------ user management -----

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function UserEditModal({ user, projects, isSelf, onClose, onNotify }) {
  // `base` is what the form started from; only fields the admin changed are saved.
  const [base, setBase] = useState(user);
  const [draft, setDraft] = useState(user);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  // Disabled projects cannot be newly assigned; ones already assigned stay listed so they can be removed.
  const projectOptions = useMemo(() => projects
    .filter((project) => project.status !== 'Disable' || (draft.assignedProjects || []).includes(project.id))
    .map((project) => ({ value: project.id, label: project.status === 'Disable' ? `${project.name} (Disable)` : project.name })), [projects, draft.assignedProjects]);

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (isSelf && !draft.role.includes('MasterAdmin')) {
      onNotify('ไม่สามารถถอดสิทธิ์ MasterAdmin ของตัวเองได้');
      return;
    }
    if (!draft.role.length) {
      onNotify('ต้องเลือกอย่างน้อย 1 Role');
      return;
    }
    setSaving(true);
    try {
      const changes = await updateUserByAdmin(base, draft);
      setBase(draft);
      onNotify(Object.keys(changes).length ? 'บันทึกข้อมูลผู้ใช้แล้ว' : 'ไม่มีการเปลี่ยนแปลง');
      onClose();
    } catch (error) {
      console.error('ไม่สามารถบันทึกผู้ใช้', error);
      onNotify('บันทึกผู้ใช้ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="editor-modal user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="user-edit-title" onSubmit={save}>
        <div className="modal-header">
          <div><div className="eyebrow">จัดการผู้ใช้งาน</div><h2 id="user-edit-title">แก้ไขผู้ใช้งาน</h2></div>
          <button type="button" className="close-button" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="profile-modal-body">
          <div className="profile-modal-identity"><Avatar profile={user} className="large" /><div><strong>{user.email}</strong><small>{STATUS_LABELS[user.status]}</small></div></div>
          <div className="editor-grid two">
            <label><span>ชื่อ</span><input value={draft.firstName || ''} onChange={(event) => set('firstName')(event.target.value)} /></label>
            <label><span>นามสกุล</span><input value={draft.lastName || ''} onChange={(event) => set('lastName')(event.target.value)} /></label>
            <label><span>ตำแหน่ง</span><input value={draft.position || ''} onChange={(event) => set('position')(event.target.value)} /></label>
            <label><span>สถานะ</span>
              <select value={draft.status} disabled={isSelf} onChange={(event) => set('status')(event.target.value)}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="field-block full-field"><span>Role (เลือกได้หลายรายการ — ได้สิทธิ์รวมทุก Role)</span><MultiSelect options={roleOptions} value={draft.role} onChange={set('role')} placeholder="เลือก Role" ariaLabel="Role" /></div>
            <div className="field-block full-field"><span>โครงการที่เข้าถึงได้</span><MultiSelect options={projectOptions} value={draft.assignedProjects} onChange={set('assignedProjects')} placeholder="ยังไม่ได้ Assign โครงการ" ariaLabel="โครงการ" /></div>
          </div>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>ยกเลิก</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}

export function UserManagementPage({ users, projects, loaded, onNotify }) {
  const { userProfile } = useAuth();
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');

  const sorted = useMemo(() => {
    const rank = { pending: 0, approved: 1, rejected: 2 };
    return [...users].sort((a, b) => (rank[a.status] - rank[b.status]) || displayNameOf(a).localeCompare(displayNameOf(b), 'th'));
  }, [users]);
  const visible = filter === 'all' ? sorted : sorted.filter((user) => user.status === filter);
  const pendingCount = users.filter((user) => user.status === 'pending').length;
  const projectName = (id) => projects.find((project) => project.id === id)?.name || id;
  // Keep the open dialog in sync with the "base" only through its own state:
  // someone else's save never resets what the admin is typing.
  const editingUser = editing && users.find((user) => user.email === editing) ;

  const decide = async (user, status) => {
    try {
      await setUserStatus(user.email, status);
      onNotify(status === 'approved' ? `อนุมัติ ${displayNameOf(user)} แล้ว` : `ปฏิเสธ ${displayNameOf(user)} แล้ว`);
    } catch (error) {
      console.error('ไม่สามารถเปลี่ยนสถานะผู้ใช้', error);
      onNotify('เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  return (
    <div className="page-content dataset-page">
      <section className="page-heading-row">
        <div><div className="eyebrow">USER MANAGEMENT</div><h1>จัดการผู้ใช้งาน</h1><p className="page-description">อนุมัติผู้สมัคร กำหนด Role และ Assign โครงการ — เปลี่ยนแปลงแบบเรียลไทม์</p></div>
        <div className="page-heading-actions user-filter">
          {[['all', 'ทั้งหมด'], ['pending', `รออนุมัติ${pendingCount ? ` (${pendingCount})` : ''}`], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ปฏิเสธ']].map(([value, label]) => (
            <button key={value} type="button" className={`secondary-button ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
      </section>

      <section className="data-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>ผู้ใช้</th><th>ตำแหน่ง</th><th>Role</th><th>โครงการ</th><th>สถานะ</th><th /></tr></thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.email}>
                  <td><div className="user-cell"><Avatar profile={user} /><div><strong>{displayNameOf(user)}</strong><small>{user.email}</small></div></div></td>
                  <td>{user.position || '-'}</td>
                  <td><RoleChips roles={user.role} /></td>
                  <td>{user.assignedProjects.length ? <span className="role-chips">{user.assignedProjects.map((id) => <span key={id} className="role-chip project">{projectName(id)}</span>)}</span> : <span className="muted">-</span>}</td>
                  <td><span className={`status-badge ${user.status}`}>{STATUS_LABELS[user.status]}</span></td>
                  <td className="user-actions">
                    {user.status !== 'approved' && <button type="button" className="primary-button" onClick={() => decide(user, 'approved')}>อนุมัติ</button>}
                    {user.status === 'pending' && <button type="button" className="secondary-button" onClick={() => decide(user, 'rejected')}>ปฏิเสธ</button>}
                    <button type="button" className="secondary-button" onClick={() => setEditing(user.email)}>แก้ไข</button>
                  </td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={6} className="user-empty">{loaded ? 'ไม่มีผู้ใช้ในหมวดนี้' : 'กำลังโหลด...'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editingUser && (
        <UserEditModal key={editingUser.email} user={editingUser} projects={projects} isSelf={editingUser.email === userProfile.email} onClose={() => setEditing(null)} onNotify={onNotify} />
      )}
    </div>
  );
}

// -------------------------------------------------------------- projects -----

function ProjectEditModal({ project, onClose, onSave }) {
  const [form, setForm] = useState({ name: project?.name || '', code: project?.code || '', description: project?.description || '', lateGraceMinutes: project ? (project.lateGraceMinutes ?? 0) : 10, status: project?.status === 'Disable' ? 'Disable' : 'Active' });
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (saving || !form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, lateGraceMinutes: Number(form.lateGraceMinutes) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form className="editor-modal profile-modal" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="modal-header"><div><div className="eyebrow">โครงการ</div><h2>{project ? 'แก้ไขโครงการ' : 'เพิ่มโครงการ'}</h2></div><button type="button" className="close-button" onClick={onClose} disabled={saving}>×</button></div>
        <div className="profile-modal-body"><div className="editor-grid two">
          <label className="full-field"><span>ชื่อโครงการ</span><input required value={form.name} onChange={set('name')} /></label>
          <label><span>รหัสโครงการ</span><input value={form.code} onChange={set('code')} /></label>
          <label><span>เข้างานสาย (นาที)</span><input type="number" min="0" step="1" required value={form.lateGraceMinutes} onChange={set('lateGraceMinutes')} /><small>สายไม่เกินจำนวนนี้ ให้นับเวลาเริ่มงานตามกะ</small></label>
          <label className="full-field"><span>รายละเอียด</span><input value={form.description} onChange={set('description')} /></label>
          <label><span>สถานะ</span><select value={form.status} onChange={set('status')}>{PROJECT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div></div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>ยกเลิก</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
      </form>
    </div>
  );
}

export function ProjectsPage({ projects, rateRows = [], onNotify }) {
  const { userProfile, isMasterAdmin } = useAuth();
  const [editing, setEditing] = useState(null); // null | 'new' | project
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const shownProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? projects.filter((project) => [project.code, project.name, project.description, project.status].some((v) => String(v || '').toLowerCase().includes(q))) : projects;
  }, [projects, search]);
  const pendingCount = useMemo(() => pendingProjectNames(rateRows, projects).length, [rateRows, projects]);

  const save = async (form) => {
    try {
      if (editing === 'new') {
        await createProject(form, userProfile);
        onNotify('เพิ่มโครงการแล้ว');
      } else {
        const changes = Object.fromEntries(Object.keys(form).filter((key) => form[key] !== (editing[key] || (key === 'status' ? 'Active' : ''))).map((key) => [key, form[key]]));
        if (Object.keys(changes).length) await updateProject(editing.id, changes);
        onNotify('บันทึกโครงการแล้ว');
      }
      setEditing(null);
    } catch (error) {
      console.error('ไม่สามารถบันทึกโครงการ', error);
      onNotify('บันทึกโครงการไม่สำเร็จ');
    }
  };

  const archive = async (project) => {
    if (!window.confirm(`ซ่อนโครงการ “${project.name}”? ข้อมูลในโครงการจะไม่ถูกลบ`)) return;
    try {
      await archiveProject(project.id);
      onNotify('ซ่อนโครงการแล้ว');
    } catch (error) {
      console.error('ไม่สามารถซ่อนโครงการ', error);
      onNotify('ซ่อนโครงการไม่สำเร็จ');
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const added = await addProjectsFromRates(rateRows, userProfile);
      onNotify(added ? `เพิ่มโครงการใหม่ ${added} รายการ` : 'ไม่มีโครงการใหม่');
    } catch (error) {
      console.error('ไม่สามารถดึงข้อมูลสถานะโครงการ', error);
      onNotify('ดึงข้อมูลสถานะโครงการไม่สำเร็จ');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="page-content dataset-page">
      <section className="page-heading-row">
        <div><div className="eyebrow">PROJECTS</div><h1>โครงการ</h1><p className="page-description">{isMasterAdmin ? `ดึงสถานะโครงการจากอัตราค่าแรง (ไม่ซ้ำ) มาเก็บไว้ที่นี่ · โครงการที่เก็บแล้วจะไม่ถูกลบ · รอเพิ่ม ${pendingCount} รายการ` : 'โครงการที่ MasterAdmin กำหนดให้คุณ'}</p></div>
        {isMasterAdmin && <div className="page-heading-actions">
          <button type="button" className="secondary-button" onClick={refresh} disabled={refreshing}>↻ {refreshing ? 'กำลังดึงข้อมูล...' : 'Refresh'}</button>
          <button type="button" className="primary-button" onClick={() => setEditing('new')}>＋ เพิ่มโครงการ</button>
        </div>}
      </section>
      {projects.length ? (
        <section className="data-panel">
          <div className="data-panel-toolbar"><div><h2>โครงการ <span className="tab-count">{projects.length}</span></h2></div><div className="toolbar-controls"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาโครงการ..." /></div></div></div>
          <div className="table-scroll">
            <table className="data-table">
              <colgroup><col style={{ width: 150 }} /><col style={{ width: '32%' }} /><col /><col style={{ width: 140 }} /><col style={{ width: 110 }} />{isMasterAdmin && <col style={{ width: 130 }} />}</colgroup>
              <thead><tr><th>รหัส</th><th>ชื่อโครงการ</th><th>รายละเอียด</th><th>เข้างานสาย (นาที)</th><th>สถานะ</th>{isMasterAdmin && <th>จัดการ</th>}</tr></thead>
              <tbody>
                {shownProjects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.code ? <strong className="employee-code">{project.code}</strong> : <span className="muted">-</span>}</td>
                    <td className="name-cell">{project.name}</td>
                    <td>{project.description || <span className="muted">-</span>}</td>
                    <td>{project.lateGraceMinutes ?? 0}</td>
                    <td><span className={`status-badge ${project.status === 'Disable' ? 'rejected' : 'approved'}`}>{project.status === 'Disable' ? 'Disable' : 'Active'}</span></td>
                    {isMasterAdmin && <td className="action-cell">
                      <button type="button" className="row-edit-button" onClick={() => setEditing(project)}>แก้ไข</button>{' '}
                      <button type="button" className="row-delete-button" onClick={() => archive(project)}>ซ่อน</button>
                    </td>}
                  </tr>
                ))}
                {!shownProjects.length && <tr><td colSpan={isMasterAdmin ? 6 : 5} className="muted">ไม่พบโครงการที่ค้นหา</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="data-panel-footer"><span>ทั้งหมด {projects.length} โครงการ{search.trim() ? ` · แสดง ${shownProjects.length}` : ''}</span></div>
        </section>
      ) : (
        <div className="period-empty"><strong>{isMasterAdmin ? 'ยังไม่มีโครงการ' : 'ยังไม่ได้รับมอบหมายโครงการ'}</strong><span>{isMasterAdmin ? 'กด Refresh เพื่อดึงโครงการจากอัตราค่าแรง หรือกด “เพิ่มโครงการ”' : 'กรุณาติดต่อ MasterAdmin เพื่อกำหนดโครงการให้คุณ'}</span></div>
      )}
      {editing && <ProjectEditModal project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}
