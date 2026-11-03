// Legacy projects and invalid values have no late-arrival grace period.
export function lateGraceMinutes(value) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes >= 0 ? minutes : 0;
}

export function validateLateGraceMinutes(value) {
  const minutes = Number(value);
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error('เข้างานสายต้องเป็นจำนวนนาทีเต็มตั้งแต่ 0 ขึ้นไป');
  return minutes;
}
