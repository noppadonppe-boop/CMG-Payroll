import { useEffect, useMemo, useState } from 'react';
import { employeeKey, subscribeToShiftAssignments, subscribeToShifts } from './shifts';
import { lateGraceMinutes } from './attendancePolicy';

// Builds `shiftFor(employeeId, date)` from every project's shifts and ตั้งกะการทำงาน assignments:
// the shift assigned to that employee on that ISO date, or null when none is assigned.
// Assignments whose shift was deleted are ignored.
export function buildShiftSchedule(shiftsByProject, assignmentsByProject, projects = []) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const byEmployee = new Map();
  Object.entries(assignmentsByProject).forEach(([projectId, assignments]) => assignments.forEach((item) => {
    const source = shiftsByProject[projectId]?.find((shift) => shift.id === item.shiftId);
    const shift = source && { ...source, projectId, lateGraceMinutes: lateGraceMinutes(projectById.get(projectId)?.lateGraceMinutes) };
    if (!shift) return;
    const key = employeeKey(item.employeeId);
    byEmployee.set(key, [...(byEmployee.get(key) || []), { startDate: item.startDate, endDate: item.endDate, shift }]);
  }));
  return (employeeId, date) => byEmployee.get(employeeKey(employeeId))?.find((item) => item.startDate <= date && date <= item.endDate)?.shift || null;
}

// Live schedule for the given projects (re-subscribes when the project list changes).
export function useShiftSchedule(projects) {
  const [shiftsByProject, setShiftsByProject] = useState({});
  const [assignmentsByProject, setAssignmentsByProject] = useState({});
  const projectKey = projects.map((project) => project.id).join('|');
  useEffect(() => {
    const ids = projectKey ? projectKey.split('|') : [];
    setShiftsByProject({});
    setAssignmentsByProject({});
    const onError = (error) => console.warn('อ่านกะการทำงานไม่สำเร็จ', error);
    const unsubscribers = ids.flatMap((projectId) => [
      subscribeToShifts({ projectId, onData: (data) => setShiftsByProject((current) => ({ ...current, [projectId]: data })), onError }),
      subscribeToShiftAssignments({ projectId, onData: (data) => setAssignmentsByProject((current) => ({ ...current, [projectId]: data })), onError }),
    ]);
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [projectKey]);
  return useMemo(() => buildShiftSchedule(shiftsByProject, assignmentsByProject, projects), [shiftsByProject, assignmentsByProject, projects]);
}
