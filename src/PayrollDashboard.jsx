// ภาพรวมค่าแรง: KPI cards and charts built from the payroll rows of the current period,
// the saved periods, Admin ลงค่าแรง requests and the ZKBioTime attendance of the period.
import { useMemo, useState } from 'react';
import { effectiveNetTotal, effectiveTravelAmount, formatCurrency, sourceCatalog } from './data/schema';
import { buildEmployeeReport } from './lib/biotimeReport';
import { useAuth } from './auth/AuthContext';
import { Avatar } from './auth/ui';
import { displayNameOf } from './auth/constants';

// Categorical order (validated for colour-blind separation on the glass surface). Fixed, never cycled.
const SERIES = ['#1f6bf0', '#14a37f', '#e0921f', '#8b5cf6', '#d6409f'];
const OTHER_COLOR = '#9db3c8';
const num = (value) => Number(value) || 0;
const baht = (value) => `฿${formatCurrency(Math.round(num(value)))}`;
const compactBaht = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `฿${(value / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `฿${(value / 1e3).toFixed(0)}K`;
  return baht(value);
};
const percent = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const thaiDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
const fullName = (row) => [row.firstName, row.lastName].filter(Boolean).join(' ') || row.employeeId || '-';
const initialOfName = (row) => String(row.firstName || row.employeeId || '?').trim().replace(/^(นางสาว|นาง|นาย|น\.ส\.|mrs?\.?|ms\.?|miss)\s*/i, '').charAt(0).toUpperCase() || '?';

const overtimeAmount = (row) => num(row.overtime15Amount) + num(row.overtime2SundayAmount) + num(row.holidayHoursAmount);
const wageStatus = (entry) => entry.status || 'approved';

// Smooth line through the points (Catmull-Rom converted to cubic Béziers).
const smoothPath = (points) => points.reduce((path, [x, y], index) => {
  if (index === 0) return `M${x},${y}`;
  const p0 = points[index - 2] || points[index - 1];
  const p1 = points[index - 1];
  const p3 = points[index + 1] || [x, y];
  const c1 = [p1[0] + (x - p0[0]) / 6, p1[1] + (y - p0[1]) / 6];
  const c2 = [x - (p3[0] - p1[0]) / 6, y - (p3[1] - p1[1]) / 6];
  return `${path} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x},${y}`;
}, '');

const niceMax = (value) => {
  if (value <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
};

function usePayrollStats({ payrollRows, rateRows, periods, period, wageEntries, biotimeRecords, shiftFor, holidayFor }) {
  return useMemo(() => {
    const rows = payrollRows.filter((row) => row.employeeId);
    const net = rows.reduce((sum, row) => sum + effectiveNetTotal(row), 0);
    const regular = rows.reduce((sum, row) => sum + num(row.regularWage ?? num(row.dailyRate) * num(row.normalDays)), 0);
    const overtime = rows.reduce((sum, row) => sum + overtimeAmount(row), 0);
    const travel = rows.reduce((sum, row) => sum + effectiveTravelAmount(row), 0);
    const allowance = rows.reduce((sum, row) => sum + num(row.positionAllowance) + num(row.phoneAllowance), 0);
    const extra = rows.reduce((sum, row) => sum + num(row.contractWork) + num(row.wageDrop), 0);
    const deductions = rows.reduce((sum, row) => sum + num(row.deduction) + num(row.socialSecurity), 0);
    const gross = regular + overtime + travel + allowance + extra;
    const workDays = rows.reduce((sum, row) => sum + num(row.normalDays), 0);
    const otHours = rows.reduce((sum, row) => sum + num(row.overtime15) + num(row.overtime2Sunday) + num(row.holidayHours), 0);
    const paidRows = rows.filter((row) => effectiveNetTotal(row) > 0);

    const composition = [
      { key: 'regular', label: 'ค่าแรงปกติ', value: regular },
      { key: 'overtime', label: 'ค่าล่วงเวลา (OT)', value: overtime },
      { key: 'travel', label: 'ค่าเดินทาง', value: travel },
      { key: 'allowance', label: 'ค่าตำแหน่ง / โทรศัพท์', value: allowance },
      { key: 'extra', label: 'งานเหมา / ค่าแรงตก', value: extra },
    ].map((item, index) => ({ ...item, color: SERIES[index] }));

    const bySheet = Object.entries(sourceCatalog.payroll.tabs).map(([sheet, config], index) => {
      const sheetRows = rows.filter((row) => row.sheet === sheet);
      return { key: sheet, label: config.label, count: sheetRows.length, value: sheetRows.reduce((sum, row) => sum + effectiveNetTotal(row), 0), color: SERIES[index] };
    });

    const departmentMap = new Map();
    rows.forEach((row) => {
      const name = String(row.department || '').trim() || 'ไม่ระบุแผนก';
      const item = departmentMap.get(name) || { label: name, value: 0, count: 0 };
      item.value += effectiveNetTotal(row);
      item.count += 1;
      departmentMap.set(name, item);
    });
    const departmentsSorted = [...departmentMap.values()].sort((a, b) => b.value - a.value);
    const departments = departmentsSorted.length > 6
      ? [...departmentsSorted.slice(0, 5), departmentsSorted.slice(5).reduce((other, item) => ({ ...other, value: other.value + item.value, count: other.count + item.count }), { label: `อื่นๆ (${departmentsSorted.length - 5} แผนก)`, value: 0, count: 0, isOther: true })]
      : departmentsSorted;

    const topEarners = [...paidRows].sort((a, b) => effectiveNetTotal(b) - effectiveNetTotal(a)).slice(0, 5);

    // Daily attendance from ZKBioTime: people with a scan and OT hours per date.
    const dayMap = new Map();
    biotimeRecords.forEach((record) => {
      buildEmployeeReport(record, shiftFor, holidayFor).rows.filter((day) => !day.leadIn).forEach((day) => {
        const item = dayMap.get(day.date) || { date: day.date, present: 0, ot: 0, isSunday: day.isSunday };
        if (day.timeIn) item.present += 1;
        item.ot += day.ot;
        dayMap.set(day.date, item);
      });
    });
    const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    const requests = { pending: 0, approved: 0, rejected: 0 };
    wageEntries.forEach((entry) => { requests[wageStatus(entry)] = (requests[wageStatus(entry)] || 0) + 1; });

    const sortedPeriods = [...periods].sort((a, b) => String(b.startDate || b.createdAt || '').localeCompare(String(a.startDate || a.createdAt || '')));

    return {
      net, gross, deductions, overtime, workDays, otHours,
      headcount: rows.length,
      paidCount: paidRows.length,
      registered: rateRows.length,
      average: paidRows.length ? net / paidRows.length : 0,
      averageDailyRate: rows.length ? rows.reduce((sum, row) => sum + num(row.dailyRate), 0) / rows.length : 0,
      overtimeShare: percent(overtime, gross),
      composition, bySheet, departments, topEarners, daily, requests,
      periods: sortedPeriods,
      currentPeriod: periods.find((item) => item.id === period?.id) || period,
    };
  }, [payrollRows, rateRows, periods, period, wageEntries, biotimeRecords, shiftFor, holidayFor]);
}

export default function PayrollDashboard({ payrollRows, rateRows, periods, period, wageEntries, biotimeRecords, shiftFor, holidayFor, onNavigate }) {
  const { userProfile } = useAuth();
  const stats = usePayrollStats({ payrollRows, rateRows, periods, period, wageEntries, biotimeRecords, shiftFor, holidayFor });
  const current = stats.currentPeriod;
  const range = current?.startDate && current?.endDate ? `${thaiDate(current.startDate)} – ${thaiDate(current.endDate)}` : '';

  return (
    <div className="page-content pd-page">
      <section className="pd-hero">
        <div className="pd-welcome">
          <Avatar profile={userProfile} className="large" />
          <div>
            <span className="pd-welcome-label">ยินดีต้อนรับ,</span>
            <h1>{displayNameOf(userProfile) || 'ภาพรวมค่าแรง'}</h1>
          </div>
        </div>
        <div className="pd-hero-side">
          <div className="pd-period-chip">
            <span className="calendar-icon">▣</span>
            <div><span className="muted-label">ภาพรวมค่าแรง · งวดปัจจุบัน</span><strong>{current?.name || 'ยังไม่ได้เลือกงวด'}</strong>{range && <small>{range}</small>}</div>
          </div>
        </div>
      </section>

      <section className="pd-kpis">
        <KpiCard title="ยอดค่าแรงสุทธิ" value={baht(stats.net)} detail={`${formatCurrency(stats.paidCount)} คนได้รับค่าแรง จาก ${formatCurrency(stats.headcount)} รายการ`} visual={<MiniBars items={stats.departments} />} />
        <KpiCard title="ค่าแรงเฉลี่ยต่อคน" value={baht(stats.average)} detail={`อัตราค่าแรงเฉลี่ย ${baht(stats.averageDailyRate)} / วัน`} icon="♙" />
        <KpiCard title="สัดส่วนค่า OT" value={`${stats.overtimeShare.toFixed(1)}%`} detail={`${baht(stats.overtime)} จากรายได้รวม ${compactBaht(stats.gross)}`} visual={<Ring value={stats.overtimeShare} />} />
        <KpiCard title="วันทำงานรวม" value={formatCurrency(stats.workDays)} unit="วัน" detail={`OT รวม ${formatCurrency(stats.otHours)} ชม.`} icon="◷" />
      </section>

      <section className="pd-grid">
        <AttendancePanel daily={stats.daily} onNavigate={onNavigate} />

        <section className="panel pd-panel pd-periods">
          <div className="pd-panel-head"><h2>งวดค่าแรง</h2><span className="pd-head-note">{stats.periods.length} งวด</span></div>
          {stats.periods.length ? (
            <ul className="pd-period-list">
              {stats.periods.slice(0, 4).map((item) => {
                const isCurrent = item.id === period?.id;
                const open = item.entryOpen !== false;
                return (
                  <li key={item.id} className={`pd-period ${isCurrent ? 'is-current' : open ? 'is-open' : 'is-closed'}`}>
                    <div><strong>{item.name}</strong><small>{item.startDate ? `${thaiDate(item.startDate)} – ${thaiDate(item.endDate)}` : `${item.rowCount || 0} รายการ`}</small></div>
                    <span className="pd-tag">{isCurrent ? 'งวดปัจจุบัน' : open ? 'เปิดลงข้อมูล' : 'ปิดลงข้อมูล'}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="pd-empty">ยังไม่มีงวดที่บันทึกไว้</p>}
          <div className="pd-requests" aria-label="คำขอ Admin ลงค่าแรงของงวดปัจจุบัน">
            <span className="pd-request pending" title="รออนุมัติ">◔ รออนุมัติ <b>{stats.requests.pending}</b></span>
            <span className="pd-request approved" title="อนุมัติแล้ว">✓ อนุมัติ <b>{stats.requests.approved}</b></span>
            <span className="pd-request rejected" title="ไม่อนุมัติ">✕ ปฏิเสธ <b>{stats.requests.rejected}</b></span>
          </div>
          <button type="button" className="primary-button pd-view-all" onClick={() => onNavigate('payroll')}>ดูทั้งหมด</button>
        </section>

        <section className="panel pd-panel">
          <div className="pd-panel-head"><h2>ค่าแรงตามแผนก</h2><button type="button" className="text-button" onClick={() => onNavigate('payroll')}>เปิดข้อมูล <span>→</span></button></div>
          <StackedBar items={stats.bySheet} total={stats.net} />
          <HorizontalBars items={stats.departments} />
        </section>

        <section className="panel pd-panel">
          <div className="pd-panel-head"><h2>โครงสร้างค่าแรง</h2><span className="pd-head-note">ก่อนหัก</span></div>
          <CompositionDonut items={stats.composition} total={stats.gross} />
          <div className="pd-deduction"><span>หักเงิน + ประกันสังคม</span><strong>−{baht(stats.deductions)}</strong></div>
        </section>

        <section className="panel pd-panel">
          <div className="pd-panel-head"><h2>ยอดสูงสุดในงวด</h2><span className="pd-head-note">Top 5</span></div>
          {stats.topEarners.length ? (
            <ul className="pd-people">
              {stats.topEarners.map((row, index) => (
                <li key={row.id || row.employeeId}>
                  <span className="pd-rank">{index + 1}</span>
                  <span className="pd-initial">{initialOfName(row)}</span>
                  <div><strong>{fullName(row)}</strong><small>{row.department || row.sheet} · {formatCurrency(row.normalDays)} วัน</small></div>
                  <b>{baht(effectiveNetTotal(row))}</b>
                </li>
              ))}
            </ul>
          ) : <p className="pd-empty">ยังไม่มีข้อมูลค่าแรงในงวดนี้</p>}
        </section>
      </section>
    </div>
  );
}

function KpiCard({ title, value, unit, detail, visual, icon }) {
  return (
    <div className="pd-kpi">
      <div className="pd-kpi-head"><span>{title}</span>{icon && <span className="pd-kpi-icon">{icon}</span>}</div>
      <div className="pd-kpi-body">
        <strong className="pd-kpi-value">{value}{unit && <small>{unit}</small>}</strong>
        {visual}
      </div>
      <span className="pd-kpi-detail">{detail}</span>
    </div>
  );
}

function MiniBars({ items }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  if (!items.length) return null;
  return (
    <div className="pd-minibars" aria-hidden="true">
      {items.map((item) => <span key={item.label} title={`${item.label}: ${baht(item.value)}`} style={{ height: `${Math.max(10, (item.value / max) * 100)}%` }} />)}
    </div>
  );
}

function Ring({ value }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(100, Math.max(0, value)) / 100 * circumference;
  return (
    <svg className="pd-ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={radius} className="pd-ring-track" />
      <circle cx="28" cy="28" r={radius} className="pd-ring-value" strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 28 28)" />
    </svg>
  );
}

const CHART = { width: 640, height: 230, left: 40, right: 16, top: 18, bottom: 28 };

function AttendancePanel({ daily, onNavigate }) {
  const [metric, setMetric] = useState('present');
  const [hover, setHover] = useState(null);
  const values = daily.map((day) => day[metric]);
  const max = niceMax(Math.max(...values, 0));
  const innerWidth = CHART.width - CHART.left - CHART.right;
  const innerHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index) => CHART.left + (daily.length > 1 ? (index / (daily.length - 1)) * innerWidth : innerWidth / 2);
  const y = (value) => CHART.top + innerHeight - (value / max) * innerHeight;
  const points = daily.map((day, index) => [x(index), y(day[metric])]);
  const line = smoothPath(points);
  const area = points.length ? `${line} L${points[points.length - 1][0]},${CHART.top + innerHeight} L${points[0][0]},${CHART.top + innerHeight} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8));
  const workDays = daily.filter((day) => !day.isSunday);
  const averagePresent = workDays.length ? workDays.reduce((sum, day) => sum + day.present, 0) / workDays.length : 0;
  const totalOt = daily.reduce((sum, day) => sum + day.ot, 0);
  const peak = daily.reduce((best, day, index) => (day[metric] > (best?.value ?? -1) ? { index, value: day[metric] } : best), null);
  const unit = metric === 'present' ? 'คน' : 'ชม.';

  const handleMove = (event) => {
    if (!daily.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * CHART.width;
    const index = Math.round(((svgX - CHART.left) / innerWidth) * (daily.length - 1));
    setHover(Math.min(daily.length - 1, Math.max(0, index)));
  };
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <section className="panel pd-panel pd-attendance">
      <div className="pd-panel-head pd-attendance-head">
        <div>
          <h2>การเข้างานรายวัน</h2>
          <div className="pd-segment" role="tablist" aria-label="ตัวชี้วัด">
            <button type="button" role="tab" aria-selected={metric === 'present'} className={metric === 'present' ? 'active' : ''} onClick={() => setMetric('present')}>จำนวนคนเข้างาน</button>
            <button type="button" role="tab" aria-selected={metric === 'ot'} className={metric === 'ot' ? 'active' : ''} onClick={() => setMetric('ot')}>ชั่วโมง OT</button>
          </div>
        </div>
        <div className="pd-attendance-stats">
          <div><span>เข้างานเฉลี่ย/วัน</span><strong>{formatCurrency(Math.round(averagePresent))} คน</strong></div>
          <div><span>OT 1.5 รวม</span><strong>{formatCurrency(totalOt)} ชม.</strong></div>
        </div>
      </div>
      {daily.length ? (
        <div className="pd-line-wrap">
          <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="pd-line" role="img" aria-label={`${metric === 'present' ? 'จำนวนคนเข้างาน' : 'ชั่วโมง OT'}รายวัน`} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
            <defs>
              <linearGradient id="pd-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={metric === 'present' ? SERIES[0] : SERIES[3]} stopOpacity=".28" />
                <stop offset="100%" stopColor={metric === 'present' ? SERIES[0] : SERIES[3]} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(tick)} y2={y(tick)} className="pd-grid-line" />
                <text x={CHART.left - 8} y={y(tick) + 4} className="pd-axis" textAnchor="end">{formatCurrency(tick)}</text>
              </g>
            ))}
            {daily.map((day, index) => (index % labelEvery === 0 || index === daily.length - 1) && (
              <text key={day.date} x={x(index)} y={CHART.height - 8} className="pd-axis" textAnchor="middle">{shortDate(day.date)}</text>
            ))}
            <path d={area} fill="url(#pd-area)" />
            <path d={line} className="pd-line-path" stroke={metric === 'present' ? SERIES[0] : SERIES[3]} />
            {peak && hover === null && (
              <g>
                <circle cx={x(peak.index)} cy={y(peak.value)} r="5" className="pd-dot" stroke={metric === 'present' ? SERIES[0] : SERIES[3]} />
                <text x={x(peak.index)} y={y(peak.value) - 12} className="pd-peak" textAnchor="middle">{formatCurrency(peak.value)} {unit}</text>
              </g>
            )}
            {hovered && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={CHART.top} y2={CHART.top + innerHeight} className="pd-crosshair" />
                <circle cx={x(hover)} cy={y(hovered[metric])} r="5" className="pd-dot" stroke={metric === 'present' ? SERIES[0] : SERIES[3]} />
              </g>
            )}
            <rect x={CHART.left} y={CHART.top} width={innerWidth} height={innerHeight} fill="transparent" />
          </svg>
          {hovered && (
            <div className="pd-tooltip" style={{ left: `${(x(hover) / CHART.width) * 100}%`, top: `${(y(hovered[metric]) / CHART.height) * 100}%` }}>
              <strong>{new Date(`${hovered.date}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
              <span>เข้างาน <b>{formatCurrency(hovered.present)}</b> คน</span>
              <span>OT <b>{formatCurrency(hovered.ot)}</b> ชม.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="pd-chart-empty">
          <strong>ยังไม่มีข้อมูลสแกนเวลาในงวดนี้</strong>
          <span>ดึงข้อมูลจาก ZKBioTime ในหน้าสรุปค่าแรงเพื่อแสดงกราฟการเข้างาน</span>
          <button type="button" className="secondary-button" onClick={() => onNavigate('payroll')}>ไปที่สรุปค่าแรง</button>
        </div>
      )}
    </section>
  );
}

function StackedBar({ items, total }) {
  const shown = items.filter((item) => item.value > 0);
  return (
    <div className="pd-stack">
      <div className="pd-stack-bar">
        {shown.map((item) => <span key={item.key} title={`${item.label}: ${baht(item.value)} (${percent(item.value, total).toFixed(1)}%)`} style={{ flexGrow: item.value, background: item.color }} />)}
        {!shown.length && <span className="is-empty" />}
      </div>
      <div className="pd-legend">
        {items.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label} <b>{compactBaht(item.value)}</b></span>)}
      </div>
    </div>
  );
}

function HorizontalBars({ items }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  if (!items.length) return <p className="pd-empty">ยังไม่มีข้อมูลค่าแรงในงวดนี้</p>;
  return (
    <ul className="pd-hbars">
      {items.map((item) => (
        <li key={item.label} title={`${item.label}: ${baht(item.value)} · ${item.count} คน`}>
          <div className="pd-hbar-label"><span>{item.label}</span><b>{compactBaht(item.value)}</b></div>
          <div className="pd-hbar-track"><span className={item.isOther ? 'is-other' : ''} style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: item.isOther ? OTHER_COLOR : undefined }} /></div>
        </li>
      ))}
    </ul>
  );
}

function CompositionDonut({ items, total }) {
  const [active, setActive] = useState(null);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const gap = 2;
  let offset = 0;
  const segments = items.filter((item) => item.value > 0).map((item) => {
    const length = (item.value / Math.max(total, 1)) * circumference;
    const segment = { ...item, dash: Math.max(0, length - gap), offset };
    offset += length;
    return segment;
  });
  const focus = items.find((item) => item.key === active);
  return (
    <div className="pd-donut">
      <div className="pd-donut-chart">
        <svg viewBox="0 0 140 140" role="img" aria-label="สัดส่วนโครงสร้างค่าแรง">
          <circle cx="70" cy="70" r={radius} className="pd-ring-track" strokeWidth="18" />
          {segments.map((item) => (
            <circle key={item.key} cx="70" cy="70" r={radius} fill="none" stroke={item.color} strokeWidth={active === item.key ? 22 : 18}
              strokeDasharray={`${item.dash} ${circumference}`} strokeDashoffset={-item.offset} transform="rotate(-90 70 70)"
              onMouseEnter={() => setActive(item.key)} onMouseLeave={() => setActive(null)} className="pd-donut-seg">
              <title>{`${item.label}: ${baht(item.value)}`}</title>
            </circle>
          ))}
        </svg>
        <div className="pd-donut-center">
          <span>{focus ? focus.label : 'รายได้รวม'}</span>
          <strong>{compactBaht(focus ? focus.value : total)}</strong>
          {focus && <small>{percent(focus.value, total).toFixed(1)}%</small>}
        </div>
      </div>
      <ul className="pd-donut-legend">
        {items.map((item) => (
          <li key={item.key} className={active === item.key ? 'is-active' : ''} onMouseEnter={() => setActive(item.key)} onMouseLeave={() => setActive(null)}>
            <i style={{ background: item.color }} />
            <span>{item.label}</span>
            <b>{percent(item.value, total).toFixed(1)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
