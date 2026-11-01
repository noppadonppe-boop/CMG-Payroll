import { useMemo, useState } from 'react';
import { MASTER_DATABASE_HOLIDAY_PATH, syncHolidays } from './lib/holidays';

const WEEKDAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const thaiDate = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

// วันหยุดบริษัท: the company holidays copied from the master database (CMG-HR-Database/root/day_offs)
// into this system by "Sync วันหยุด". The Biotime report reads this copy for its วันหยุดบริษัท (ชม.) column.
export default function HolidaysPage({ holidays, loaded, canSync, onNotify }) {
  const [syncing, setSyncing] = useState(false);
  const [year, setYear] = useState('all');
  const years = useMemo(() => [...new Set(holidays.map((holiday) => holiday.date.slice(0, 4)))].sort(), [holidays]);
  const shown = useMemo(() => (year === 'all' ? holidays : holidays.filter((holiday) => holiday.date.startsWith(year))), [holidays, year]);
  const lastSync = useMemo(() => holidays.reduce((latest, holiday) => (holiday.syncedAt > latest ? holiday.syncedAt : latest), ''), [holidays]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncHolidays();
      onNotify(`Sync วันหยุดสำเร็จ: ทั้งหมด ${result.total} วัน · เพิ่ม ${result.created} · อัปเดต ${result.updated} · ลบ ${result.removed} · ไม่เปลี่ยนแปลง ${result.unchanged}`);
    } catch (error) {
      console.error('Sync วันหยุดบริษัท', error);
      onNotify(error?.code === 'permission-denied' ? 'Sync ไม่สำเร็จ: Firebase ปฏิเสธสิทธิ์'
        : error?.code === 'master-database-not-configured' ? 'Sync ไม่สำเร็จ: ยังไม่ได้ตั้งค่า Master Database'
        : 'Sync ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="page-content dataset-page">
      <section className="page-heading-row">
        <div>
          <div className="eyebrow">COMPANY HOLIDAYS</div>
          <h1>วันหยุดบริษัท</h1>
          <p className="page-description">สำเนาวันหยุดจากฐานข้อมูลกลาง ({MASTER_DATABASE_HOLIDAY_PATH}) · ใช้คำนวณคอลัมน์ “วันหยุดบริษัท (ชม.)” ในการลงเวลา Biotime</p>
        </div>
        {canSync && <button type="button" className="primary-button" onClick={sync} disabled={syncing}>{syncing ? 'กำลัง Sync...' : '↻ Sync วันหยุด'}</button>}
      </section>
      <section className="data-panel">
        <div className="data-panel-toolbar">
          <div><h2>รายการวันหยุด</h2><p>{lastSync ? `Sync ล่าสุด ${new Date(lastSync).toLocaleString('th-TH')}` : 'ยังไม่เคย Sync'}</p></div>
          <div className="toolbar-controls">
            <select value={year} onChange={(event) => setYear(event.target.value)} aria-label="ปี">
              <option value="all">ทุกปี</option>
              {years.map((item) => <option key={item} value={item}>{Number(item) + 543}</option>)}
            </select>
          </div>
        </div>
        <div className="table-summary"><span>ทั้งหมด <strong>{shown.length}</strong> วัน</span></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>No.</th><th>วันที่</th><th>วัน</th><th>ชื่อวันหยุด</th><th>วันที่ (ISO)</th></tr></thead>
            <tbody>
              {shown.map((holiday, index) => (
                <tr key={holiday.date}>
                  <td>{index + 1}</td>
                  <td>{thaiDate(holiday.date)}</td>
                  <td>{weekdayOf(holiday.date)}</td>
                  <td>{holiday.name || '-'}</td>
                  <td>{holiday.date}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={5}>{loaded ? (canSync ? 'ยังไม่มีวันหยุด · กด “Sync วันหยุด” เพื่อดึงจากฐานข้อมูลกลาง' : 'ยังไม่มีวันหยุด') : 'กำลังโหลด...'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
