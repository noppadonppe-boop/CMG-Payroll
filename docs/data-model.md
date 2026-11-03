# CMG Payroll: โครงสร้างข้อมูล Firestore

ไฟล์ Excel ที่แนบมาใช้เป็นต้นแบบโครงสร้างข้อมูลเท่านั้น ไม่ได้ถูกตีความเป็นคำสั่งให้ระบบทำงาน

## โครงสร้างพื้นที่จัดเก็บกลาง

ระบบใช้ collection เดียวร่วมกันทุกผู้ใช้และไม่ใช้ UID เป็นโฟลเดอร์:

```text
CMG-Payroll (collection)
└── root (document)
    ├── rates (subcollection)
    │   └── {documentId}
    ├── payroll (subcollection)
    │   └── {documentId}
    └── payrollPeriods (subcollection)
        └── {periodId}
            └── revisions (subcollection)
                └── {revisionId}
                    └── rows (subcollection)
                        └── {rowId}
```

แอปจะพยายามเข้าสู่ระบบด้วย Firebase Anonymous Authentication เพื่อให้ Rules ที่ต้องการ authentication ทำงานได้ แต่ path ของข้อมูลยังเป็น shared path เดิมสำหรับทุกคน

## เมนูและแท็บ

ตารางหน้าเว็บแบ่งหน้า 50 รายการต่อหน้า และส่งเฉพาะแถวของหน้าปัจจุบันเข้าไป render เพื่อไม่ให้แถวของหน้าอื่นสร้าง DOM ค้างไว้ การค้นหาหรือเปลี่ยนแท็บจะกลับไปหน้าแรกอัตโนมัติ

| เมนู | Collection | แท็บ | แหล่งข้อมูล |
| --- | --- | --- | --- |
| ค่าแรงรายงวด | `CMG-Payroll/root/payroll` และ `CMG-Payroll/root/payrollPeriods` | `DC`, `SUPPLY`, `ซอ` | รายชื่อและอัตราจาก `rates`; snapshot การบันทึกอยู่ใน `payrollPeriods` |
| อัตราค่าแรง | `CMG-Payroll/root/rates` | `DC`, `SUPPLY` | `อัตราค่าแรง.xlsx` |

## Subcollection: `CMG-Payroll/root/rates`

หนึ่งเอกสารต่อพนักงานและชุดงาน โดยใช้ `sheet` แยกแท็บ

```text
sheet: "DC" | "SUPPLY"
employeeId: string
firstName: string
lastName: string
department: string
position: string
dailyRateYear69: number
travelRate: number | string
positionAllowance: number
specialPosition: string
specialPositionAmount: number
phoneAllowance: number
welfareSupport: number
status: string
nameChangedAt: string
nameChangedFields: array<string>
updatedAt: string
attachments: array<object>
```

คอลัมน์ `ค่าตำแหน่งพิเศษ` ใช้ `specialPosition` เป็นชื่อรายการจาก Dropdown และ `specialPositionAmount` เป็นจำนวนเงิน โดยรายการตัวเลือกที่ผู้ดูแลเพิ่ม/ลบจะบันทึกไว้ในเอกสาร `CMG-Payroll/root/settings/special-position-options` ของ Firebase และเก็บ Local Storage ไว้เป็น fallback เมื่อ Firebase ใช้งานไม่ได้ ส่วนค่าที่เลือกและจำนวนเงินของแต่ละพนักงานจะบันทึกในเอกสาร Firebase ตามปกติ

## Subcollection: `CMG-Payroll/root/payroll`

ข้อมูลชุดนี้เป็น working table ของหน้าเว็บ หนึ่งเอกสารต่อพนักงานต่อแท็บ โดยใช้ `sheet` แยกแท็บ หน้าเว็บจะสร้าง/เติมรายชื่อจาก `rates` อัตโนมัติ และแท็บ `ซอ` ใช้รายชื่อจาก `SUPPLY` เป็นค่าเริ่มต้น เมื่อเปิดงวดใหม่ ระบบจะคงข้อมูลตัวตนและอัตราค่าแรงไว้ แต่รีเซ็ตตัวเลขการทำงานเป็น `0`

```text
periodId: string
sheet: "DC" | "SUPPLY" | "ซอ"
sequence: number
employeeId: string
firstName: string
lastName: string
department: string
position: string
normalDays: number
overtime15: number
overtime2Sunday: number
holidayHours: number
travelFormula: number
dailyRate: number
travelRate: number | string
positionAllowance: number
phoneAllowance: number
overtimeRate15: number
regularWage: number
overtime15Amount: number
overtime2SundayAmount: number
holidayHoursAmount: number
positionPhoneTotal: number
travelAmount: number
contractWork: number
wageDrop: number
deduction: number
socialSecurity: number
netTotal: number
note: string
updatedAt: string
attachments: array<object>
```

## Subcollection: `CMG-Payroll/root/payrollPeriods`

ใช้เก็บงวดค่าแรงและประวัติ Revision แบบไม่เขียนทับข้อมูลเดิม โดย `status` ของงวดและ Revision ที่สร้างจากหน้าจอนี้เป็นค่า `Savedraft`

เอกสารงวด `CMG-Payroll/root/payrollPeriods/{periodId}`:

```text
name: string
status: "Savedraft"
activeRevisionId: string
createdAt: string
updatedAt: string
```

เอกสาร Revision `CMG-Payroll/root/payrollPeriods/{periodId}/revisions/{revisionId}`:

```text
periodId: string
periodName: string
revisionName: string
status: "Savedraft"
rowCount: number
sheets: array<string>
savedAt: string
updatedAt: string
```

แต่ละ Revision มี subcollection `rows` ที่เก็บ snapshot ของแถวทั้งหมดจากแท็บ `DC`, `SUPPLY` และ `ซอ` โดยใช้ฟิลด์ของ Payroll row เดิม พร้อม `sourceRowId`, `periodId`, `revisionId` และ `updatedAt` ระบบสร้าง `revisionId` ใหม่ทุกครั้งที่กดบันทึก จึงเก็บ Revision ก่อนหน้าไว้ครบถ้วน

## Firebase Storage

ไฟล์ที่แนบจากหน้าต่างเพิ่ม/แก้ไขรายการจะถูกเก็บไว้ที่:

```text
CMG-Payroll/root/{category}/{sheet}/{documentId}/{timestamp}-{fileName}
```

เอกสาร Firestore จะเก็บ metadata ของไฟล์ใน `attachments` เช่น `name`, `size`, `type`, `path`, `url` และ `uploadedAt`

## Master Database: ทะเบียนพนักงาน

ปุ่ม `Sync ข้อมูล` ในเมนู `อัตราค่าแรง` อ่าน Firestore ของโปรเจกต์ Master Database จาก collection:

```text
CMG-HR-Database/root/employee_data
```

ข้อมูลต้นทางที่นำเข้า ได้แก่ `employeeId` (`รหัสพนักงาน`), `firstName` (`ชื่อตัว`), `lastName` (`ชื่อสกุล`), `department` (`ชื่อชุด`), `position` (`ตำแหน่ง`), `project` (`สถานะโครงการ` ซึ่งเป็นรายการ นำมาต่อกันด้วย `, `) และ `employeeStatus` (`สถานะพนักงาน`) แล้ว upsert เข้า `CMG-Payroll/root/rates` โดยใช้ `employeeId` เป็นตัวจับคู่ ฟิลด์อัตราค่าแรงและสวัสดิการเดิมจะไม่ถูกลบทับเมื่อ Sync

เมื่อ Sync พบว่าชื่อหรือนามสกุลของพนักงานเดิมเปลี่ยน ระบบจะบันทึก `nameChangedAt` และ `nameChangedFields` เพื่อไฮไลต์ช่องชื่อเป็นสีเหลืองเป็นเวลา 24 ชั่วโมง ส่วนพนักงานใหม่จะถูกเพิ่มโดยไม่ไฮไลต์

กติกาแยกแท็บ: รหัสขึ้นต้น `DC` และ `Intern` ไปแท็บ `DC`, รหัสขึ้นต้น `SP` ไปแท็บ `SUPPLY`, รหัสอื่นไม่นำเข้า นำเข้าเฉพาะ `employeeStatus = ทำงาน` และแถวที่สถานะไม่ใช่ `ทำงาน` จะถูกซ่อนในตาราง

## Collections ที่แนะนำสำหรับเฟสถัดไป

- เพิ่มข้อมูลช่วงวันที่ โครงการ จำนวนวันทำงานปกติ และหมายเหตุวันหยุดใน `payrollPeriods`
- `holidays`: เก็บวันที่และประเภทวันหยุด เพื่อคำนวณวันทำงาน/OT โดยไม่ต้องแก้ข้อมูลพนักงาน
- `users`: เก็บบทบาทผู้ใช้ เช่น `admin`, `payroll`, `viewer`

## การคำนวณหลัก

- ค่าแรงปกติ = `dailyRate × normalDays`
- ค่าเดินทาง = `0` เมื่อ `travelRate` เป็น `พักแคมป์` หรือ `พักแค้มป์`
- OT 1.5 = `(dailyRate ÷ 8 × 1.5) × overtime15`
- OT 2 วันอาทิตย์/วันหยุด = `(dailyRate × 2) × จำนวนชั่วโมงหรือวัน`
- รวมสุทธิ = รายได้ทั้งหมด - เงินหัก - ประกันสังคม

สูตรควรย้ายไปไว้ใน Cloud Functions หรือ service layer เมื่อเริ่มใช้ข้อมูลจริง เพื่อให้ผลลัพธ์สอดคล้องกันทุกหน้าจอ

## ระบบผู้ใช้งานและโครงการ

```text
CMG-Payroll/root
├── users/{email}            UserProfile (role เป็น array, status, assignedProjects)
├── appMeta/config           { firstUserRegistered, totalUsers, createdAt }
├── activityLogs/{id}        REGISTER / LOGIN
├── projects/{projectId}     อยู่ layer เดียวกับ users (Assign ให้ผู้ใช้เป็นรายคน)
├── rates / payroll / settings / payrollPeriods / deletedPayrollPeriods   ← ข้อมูลกลาง ไม่ผูกโครงการ
```

- ผู้ใช้คนแรกที่ลงชื่อเข้าใช้ (Firestore transaction) จะเป็น `MasterAdmin` + `approved` ที่เหลือเป็น `Staff` + `pending`
- Role: `MasterAdmin` (ทุกอย่าง), `PayrollAdmin` (สรุปค่าแรง), `RateAdmin` (อัตราค่าแรง), `WageEntry` (Admin ลงค่าแรง), `Staff` (ภาพรวม) หลาย Role ได้สิทธิ์รวมกัน
- เมนู อัตราค่าแรง และ สรุปค่าแรง เป็นข้อมูลกลาง ไม่ผ่านโครงการ (เห็นเฉพาะ MasterAdmin) แยกหมวดใน Sidebar
- ผู้ใช้เห็นเฉพาะโครงการที่ MasterAdmin Assign ให้ โมดูลอนาคตที่ผูกโครงการให้เก็บใต้ `projects/{projectId}`

โครงการเก็บ `lateGraceMinutes` เป็นจำนวนเต็มตั้งแต่ 0 หน่วยนาที โครงการใหม่ทั้งที่เพิ่มเองและดึงจากอัตราค่าแรงมีค่าเริ่มต้น 10 นาที (โครงการเดิมที่ไม่มีฟิลด์นี้ใช้ 0) แก้ไขได้ในเมนูโครงการ โดยการลงเวลาใช้ค่าจากโครงการของกะที่ Assign ให้พนักงานในวันนั้น หากเข้าไม่เกินเวลาเริ่มกะบวกจำนวนนาทีนี้ ให้นับเวลาเริ่มงานตามกะ แต่ยังแสดงเวลาสแกนจริงและต้องมีเวลาออกหลังเวลาเข้า การออกก่อนเลิกกะยังลดวันทำงานตามสูตรเดิม และ OT/วันอาทิตย์/วันหยุดบริษัทใช้กติกาเดิม การแก้ค่านี้มีผลกับรายงานที่คำนวณใหม่จากข้อมูลสแกนที่บันทึกไว้ด้วย
- ตัวอย่าง Firestore Rules อยู่ที่ `firestore.rules` และต้องเปิด Google + Email/Password ใน Firebase Authentication พร้อมเพิ่มโดเมนใน Authorized domains

## UI layout rules

- Data table pages must never show two vertical scrollbars. The page itself must not scroll; only the table (`.table-scroll`) scrolls, and its header row stays frozen (`position: sticky`).
- Implemented in `src/styles.css` (section "Single scroll"): `.main-content` is locked to `100vh` when it contains `.dataset-page > .data-panel`, and the panel/table-scroll fill the remaining height with `min-height: 0`.
