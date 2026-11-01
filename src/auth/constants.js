// Shared auth constants. The Firestore root matches the existing data root
// (`CMG-Payroll/root/...`) so users, projects and project data live side by side.
export const APP_NAME = 'CMG-Payroll';

/**
 * @typedef {'MasterAdmin'|'PayrollAdmin'|'RateAdmin'|'WageEntry'|'Staff'} UserRole
 *
 * @typedef {Object} UserProfile
 * @property {string} uid
 * @property {string} email
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} position
 * @property {UserRole[]} role            one user can hold several roles (permissions are combined)
 * @property {'pending'|'approved'|'rejected'} status
 * @property {string[]} assignedProjects  project ids assigned by MasterAdmin
 * @property {import('firebase/firestore').Timestamp} createdAt
 * @property {string} [photoURL]
 * @property {boolean} isFirstUser
 *
 * @typedef {Object} AppMetaConfig
 * @property {boolean} firstUserRegistered
 * @property {number} totalUsers
 * @property {import('firebase/firestore').Timestamp} createdAt
 */

export const ROLES = ['MasterAdmin', 'PayrollAdmin', 'RateAdmin', 'WageEntry', 'Staff'];
export const DEFAULT_ROLE = 'Staff';
export const MASTER_ADMIN_ROLE = 'MasterAdmin';

export const ROLE_LABELS = {
  MasterAdmin: 'MasterAdmin (ทุกสิทธิ์)',
  PayrollAdmin: 'PayrollAdmin (สรุปค่าแรง)',
  RateAdmin: 'RateAdmin (อัตราค่าแรง)',
  WageEntry: 'WageEntry (Admin ลงค่าแรง)',
  Staff: 'Staff (ภาพรวม)',
};

export const STATUS_LABELS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' };

// Roles that unlock each module. MasterAdmin unlocks everything; `null` means
// every approved user may open the module. Roles never override each other:
// a user with several roles gets the union of their modules.
export const MODULE_ROLES = {
  overview: null,
  projects: null,
  rates: [], // MasterAdmin only
  payroll: [], // MasterAdmin only
  adminWage: ['WageEntry'],
  holidays: [], // MasterAdmin only (Sync วันหยุด writes the shared copy)
  shifts: [], // MasterAdmin only (shift profiles are stored under the project, which only MasterAdmin may write)
  users: [],
};

export const toRoleList = (role) => {
  const list = Array.isArray(role) ? role : (role ? [role] : []);
  const valid = [...new Set(list.filter((item) => ROLES.includes(item)))];
  return valid.length ? valid : [DEFAULT_ROLE];
};

export const hasRole = (profile, ...roles) => {
  if (!profile) return false;
  const owned = toRoleList(profile.role);
  return owned.includes(MASTER_ADMIN_ROLE) || roles.some((role) => owned.includes(role));
};

export const isMasterAdmin = (profile) => toRoleList(profile?.role).includes(MASTER_ADMIN_ROLE);

export const canAccessModule = (profile, moduleId) => {
  if (!profile || profile.status !== 'approved') return false;
  if (isMasterAdmin(profile)) return true;
  const allowed = MODULE_ROLES[moduleId];
  if (allowed === undefined) return false;
  if (allowed === null) return true;
  return hasRole(profile, ...allowed);
};

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const displayNameOf = (profile) => (
  [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.email || ''
);

export const initialOf = (profile) => (displayNameOf(profile).trim().charAt(0) || '?').toUpperCase();
