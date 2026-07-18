# CentEducation — School Management System

### Complete Functional Specification, Data Model & Security Reference

> **Purpose.** A complete, feature-by-feature description of the CentEducation platform:
> what every part does, who uses it, the rules and edge cases behind it, the exact data it
> stores, and **how access and security work**. Grounded in the actual codebase
> (Django/DRF + Next.js + PostgreSQL), not a generic template.
>
> **Why it exists.** This is the **blueprint for the next-generation system** — a separate,
> ground-up rebuild aiming to be _the most secure school platform_. Treat this as the
> source of truth for _what the product must do_ and _which trust boundaries it must
> enforce_. Sections marked **🔧 Build-next** and especially **🔐 Security-next** are
> explicit guidance for that rebuild; everything else documents current behaviour so the
> new system can match it or deliberately improve on it.
>
> _Internal document — not for the public repo / GitHub._

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [Architecture & technology](#2-architecture--technology)
3. [Roles, access & security](#3-roles-access--security) ← read first for the rebuild
4. [Data model (data dictionary)](#4-data-model-data-dictionary)
5. [Foundation & academic setup](#5-foundation--academic-setup)
6. [People & profiles](#6-people--profiles)
7. [Academics & examinations](#7-academics--examinations)
8. [Attendance & RFID](#8-attendance--rfid)
9. [Fees, billing & dues](#9-fees-billing--dues)
10. [Accounting (double-entry)](#10-accounting-double-entry)
11. [Library](#11-library)
12. [Communication](#12-communication)
13. [Dashboards, search & reports](#13-dashboards-search--reports)
14. [Year-end: closing & promotion](#14-year-end-closing--promotion)
15. [Super admin & operations](#15-super-admin--operations)
16. [Complete API surface](#16-complete-api-surface)
17. [Threat model & security blueprint for the next system](#17-threat-model--security-blueprint-for-the-next-system)
18. [Product/architecture recommendations for the next system](#18-productarchitecture-recommendations-for-the-next-system)
19. [Business rules & invariants (preserve these in the rebuild)](#19-business-rules--invariants-preserve-these-in-the-rebuild)
20. [Appendix: running the reference implementation](#20-appendix-running-the-reference-implementation)

---

## 1. Product overview

**CentEducation** (vendor: _Cent IT Solutions_) is a **multi-tenant** school management
platform. One deployment serves many schools; each school ("School Admin") is an isolated
tenant with its own students, staff, finances, and settings. It digitises school workflows
end-to-end:

- **Admissions & profiles** — students, guardians, staff, medical & transport info.
- **Academic structure** — academic years, classes, courses, sections, subjects, periods.
- **Examinations** — exam setup, schedules, marks entry, result calculation, grading,
  positions, mark-sheets, character certificates, extra-curricular records.
- **Attendance** — manual class/staff attendance **and** automated RFID/biometric devices.
- **Fees & billing** — fee structures, student ledgers (billing), invoices/receipts,
  discounts, dues, cash receipts, and staff salary billing.
- **Accounting** — full double-entry book-keeping (ledgers, vouchers, trial balance, P&L,
  balance sheet).
- **Library** — catalogue, copies, issue/return/renew, fines.
- **Communication** — notices, news & events, calendar, SMS, mobile push.
- **Transport** — bus stations, fees, and live bus-proximity alerts.
- **Reporting & search** — dashboards, statistics, dues reports, income plans, audit log.
- **Year-end** — academic-year closing with promotion & dues carry-forward; accounting-year
  closing.
- **Mobile app** — students and staff (push, OTP login, attendance, homework, results,
  notices).

A separate **Super Admin** layer (the vendor) provisions schools and broadcasts
organisation-wide messages; a Django **superuser** sits above everything for support.

### Who uses it

| Actor                                           | Goal                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| School owner/principal (**Admin**)              | Run the whole school: setup, fees, exams, staff, students, reports |
| Teachers / accountants / librarians (**Staff**) | Day-to-day operations, scoped by permission                        |
| Students & parents (**Student** app)            | Results, homework, notices, attendance, dues, push                 |
| Vendor onboarding team (**Super Admin**)        | Create & manage schools, broadcast messages                        |
| Developer/support (**Superuser**)               | Backups, emergencies, cross-tenant support                         |

---

## 2. Architecture & technology

| Layer          | Technology                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Frontend (web) | Next.js 15 (Pages Router), React, Material Tailwind, Tailwind; React Context; Axios; Yup; Sentry |
| Mobile         | Companion app (FCM push, device-token login, OTP)                                                |
| Backend        | Django 5 + Django REST Framework (DRF); drf-yasg (Swagger/ReDoc)                                 |
| Database       | PostgreSQL (Django ORM + psycopg2); uses JSON aggregation, `DISTINCT ON`                         |
| Cache          | Redis (django-redis)                                                                             |
| Files/images   | Pillow; django-cleanup (auto-removes orphaned files)                                             |
| Dates          | **Nepali (Bikram Sambat) calendar** via `nepali-datetime` + custom `NepaliDateField`             |
| Push           | Firebase Cloud Messaging (google-auth + requests)                                                |
| SMS            | Per-school third-party gateway (each school supplies its own API key)                            |
| Server         | Gunicorn; Sentry; a live system-resource monitor page                                            |

**Backend apps:** `account` (auth), `main` (core: academics/billing/people/attendance/
communication/reports/year-end), `accounting` (double-entry), `library`, `rfid` (devices),
`monitor` (server page).

**URL prefixes:** `/auth/*`, `/api/*` (+`/api/v1`, `/api/v2`), `/accounting/*`,
`/library/*`, `/rfid/*` (admin), `/iclock/*` (device protocol). Docs: `/api/docs/`,
`/api/redoc/`.

### Cross-cutting conventions (apply everywhere)

- **Soft delete.** Records carry `is_active`; "delete" sets it `False`. Lists show active
  only. Keeps finance/audit/history coherent.
- **Automatic audit.** Most core records auto-log create/update with actor, school,
  field-level diff, and IP.
- **Nepali dates.** "Date" fields are Bikram Sambat (e.g. `2081-03-15`); some timestamps
  (`created_at`, RFID punches) are UTC datetimes.
- **Tenant scoping.** Almost every record links to a `school`. Staff/Admin requests must
  carry a `school` id and the token must belong to that school.
- **Money.** `Decimal(10,2)` unless noted.
- **JSON snapshots.** Invoices/ledgers snapshot fee-title names (`__titles`) at write time
  so historical receipts read correctly after renames.

---

## 3. Roles, access & security

> This chapter documents the **current** access model. The next system's hardened target is
> in [chapter 17](#17-threat-model--security-blueprint-for-the-next-system).

### 3.1 The five roles

Each role has its **own account table** and **own token table** (tokens never collide).

| Role                     | Who                                   | Created by                  | Use                                          |
| ------------------------ | ------------------------------------- | --------------------------- | -------------------------------------------- |
| **Superuser**            | Developer/vendor root (Django `User`) | System/CLI                  | Support, backup, emergencies                 |
| **Super Admin**          | Vendor onboarding staff               | Superuser                   | Create School Admins, broadcast org messages |
| **Admin (School Admin)** | The school (tenant)                   | Super Admin                 | Runs the whole school                        |
| **Staff**                | Teacher/accountant/librarian…         | School Admin                | Operations, scoped by permission             |
| **Student**              | Student app login                     | School Admin (at enrolment) | Results, homework, notices, attendance, push |

- A **School Admin** _is_ the tenant (`SchoolAdmin` profile 1:1 `AdminAccount`).
- **Staff/Student** profiles each optionally link 1:1 to a login (a profile can exist
  without a login and gain one later).
- Shared account fields: unique `username` (6–25), hashed `password`, `verified`, OTP
  fields; staff/student accounts also hold an `app_device_token`.

### 3.2 Authentication & login

- **Role-based login** `POST /auth/signin` (or per-role `/auth/{role}/signin`): looks up the
  account among **verified** accounts of that role → verifies password → issues a stable
  token → updates `last_login`.
- For **staff/student**, a supplied `device_token` is stored for push; a **student**'s
  device is auto-subscribed to its school's FCM topic (one topic send reaches all).
- Response returns the token **and** a role-appropriate **profile** (admin → school profile;
  staff → profile incl. `permissions`; student → student profile).
- The token is also set as an **httpOnly, Secure, SameSite=None cookie** `smsys` (3-day
  life), domain auto-switching between the Vercel domain and `.nirsabi.com`.
- **Super Admin login** can also elevate a Django **superuser**.
- **Token scheme:** `Authorization: IGNITE <token>` (custom keyword) **or** the `smsys`
  cookie. 40-char hex, one token model per role.
- **Token validation** `GET /auth/obtain` (+per-role) restores a session on app load.
- **Password change** `PUT /auth/change_password` **deletes the token** (forces re-login).
- **Account update** `PUT /auth/account_update` (e.g. Admin updates `sms_api`).
- **Logout** `POST /auth/logout`.

### 3.3 OTP (students)

- `GET /auth/otp/resend` generates a TOTP (pyotp), stores `secret`+`otp`, sends via the
  **school's own SMS key**. Requires SMS configured.
- `POST /auth/otp/verify` verifies; expiry = `OTP_EXPIRY_SECONDS` env; TOTP window ±1.

### 3.4 Multi-tenancy & isolation (the core trust boundary)

- Every tenant-owned record carries a `school` FK.
- For **staff/admin** requests the authenticator extracts a `school` id (from query/body/
  `class_info.school`) and **verifies the token user belongs to that school** (a Staff of,
  or the Admin of, that school). A token for school A cannot act on school B.
- Student/Superadmin/Superuser tokens skip the cross-check (scoped or cross-tenant by design).

> ⚠️ **Current weakness (fix in rebuild):** isolation relies on each view _remembering_ to
> filter by `school`, and the school id is taken partly from client-supplied request data.
> See [chapter 17](#17-threat-model--security-blueprint-for-the-next-system).

### 3.5 Staff permissions

Each `Staff` carries a `permissions` JSON list controlling which modules/actions they may
use; it is returned at login and drives the UI. The backend also supports a per-view,
per-method role gate (`allowed_user_roles`). **Today the JSON permission is mostly a UI gate
— not consistently enforced server-side.**

### 3.6 Audit log (automatic)

`BaseModel` auto-logs via signals: **create** → log; **update** → log **with a field-level
diff**; delete is captured as the `is_active` update. Each `HistoryLog` row stores **who**
(account type+id), **school**, **which record** (generic FK), **action**, **diff**, **IP**,
**timestamp**. This backs cashier/accountant attribution (the actor who created the
invoice/voucher) and a Django-admin audit viewer.

### 3.7 Soft delete & referential guards

- Soft delete by default (`is_active=False`).
- **Referential guards** block deleting referenced records — **Bus Station**, **Course**,
  **Section**.
- **Subjects** are specially protected: a subject **used/assigned anywhere** can never be
  deleted; `Subject.is_protected=True` is a hard lock even before references exist.

---

## 4. Data model (data dictionary)

**Shared base fields** (most entities, via `BaseModel`): `created_at` (date),
`updated_at` (datetime), `is_active` (soft delete). Not repeated below.
Notation: `FK→X`, `1:1→X`, `(opt)` optional, `BS` Nepali date, money = Decimal(10,2).

### 4.1 Accounts & tokens (`account`)

- **BaseAccount** → SuperAdmin/Admin/Staff/Student: `username` (unique 6–25), `password`,
  `verified`, `secret`, `otp`. SuperAdmin +`full_name`; Admin +`sms_api`; Staff/Student +`app_device_token`.
- **Auth tokens** (one per role): `key` (40-hex PK), `created`, 1:1 `user`.

### 4.2 Organisation & tenant (`main`)

- **SchoolFoundation** — `name`, `contact`, `address`, `ceo`, `estd_date`,
  `shareholders` (JSON `[{name,contact}]`).
- **SchoolAdmin** _(tenant)_ — `name`, `address`, `contact`, `telephone`, `estd_date`,
  `pan_no`, `email`, `slogan`, `about_us`; `account` 1:1; `renew_date`, `economic_year`;
  branding `logo`/`award_logo`/`sign`/`exam_coordinator_sign`; settings `preferences`(JSON),
  `education_levels`(JSON), `test_account`, `uses_sms`, `uses_mobile_app`; attendance policy
  `time_set_required`, `attendance_in_time`, `attendance_out_time`; `foundation`.
- **SchoolImage** — `image`, `school`.

### 4.3 Fiscal & academic years

- **FiscalYear** (abstract) — `name`, `start_date`, `end_date`, `closed`, `remarks`.
- **EconomicYear** (billing year), **AcademicYear** (+`school`),
  **AccountingEconomicYear** (`accounting`, +`school`, `previous_ey` self-FK).
- **AcademicYearMapping** — `school`, `key` (faculty group), `academic_year` (running),
  `previous_academic_year`. **Source of truth for "current year" per faculty group.**

### 4.4 Class structure

- **Course** (`course`, `education_level`, `school`); **Section** (`section`, `school`).
- **ClassDetails** (abstract key): `education_level`, `grade`(opt), `faculty`(opt),
  `course`(opt), `section`(opt), `year`(opt), `semester`(opt), `name`(opt).
- **ClassInfo** = ClassDetails + `academic_year`(opt) + `school`; **unique** on the full
  tuple.
- **Subject** — `type` (compulsory/optional), `order`, `code`, `subject`, `credit_hours`;
  practical `code_pr`/`subject_pr`/`credit_hours_pr`(opt); `is_protected`; `school`,
  `class_info`.
- **ClassPeriod** — `class_info`, `period_count`, `subjects`(JSON), `teachers`(JSON),
  `academic_year`(opt).

### 4.5 Students

- **Student** — names; `birth_date`, `gender`, `email`(opt), `contact`(opt), `location`;
  `class_info`, `academic_year`, `status`; `roll_no`, `symbol_no`, `regd_no`, `emis`;
  documents `image`/`birth_certificate`/`nid`/`citizenship_front`/`citizenship_back`;
  `previous_school`, `remarks`, `rfid_card`; `guardian_info` 1:1, `other_info` 1:1(opt),
  `account` 1:1(opt).
- **StudentGuardianInfo** — parents/guardian names, occupations(opt), `guardian_contact`,
  `guardian_email`(opt), `guardian_location`(opt).
- **StudentOtherInfo/BaseOtherInfo** — `ethnicity`, `sport`, `blood_group` (opt).
- **StudentMedicalInfo** (1/student) — chronic/allergies/surgeries/disability/vision/
  hearing/medication flags+details, `remarks`.
- **StudentTransportationInfo** — `bus_station`(opt), `start_date`, `student`, `school`,
  `remarks`.
- **StudentDiscountInfo** — `title`(opt), `discount` or `percentage`, `student`, `school`,
  `remarks`, `academic_year`(opt). The AY (derived from the student's class at creation)
  scopes the discount, so the same fee title can be discounted again after the student moves
  to a new class/year, and reports can group discounts by year.
- **PendingStudentPhoto** — `class_info`, `school`, `image`, `note`, `uploader_staff`(opt);
  hard-deleted on pairing.

### 4.6 Staff

- **StaffRole** (`role`). **StaffFinanceInfo** (abstract): `basic_salary`, `grade`,
  `allowance`, `extra`, `insurance`, `pf_contrib`, `pan_no`.
- **StaffOtherInfo** — +`birth_date`, `gender`, `email`, parents, `qualification`,
  `experience`, `marrital_status`, `joined_date`.
- **Staff** — `role`, `status`, names, `primary_subject`/`secondary_subject`(opt), contacts,
  `location`, `rfid_card`, `image`, `other_info` 1:1(opt), `school`, `account` 1:1(opt),
  `permissions`(JSON).

### 4.7 Fees & billing (student finance)

- **FeeTitle** — `title`, `months`(JSON), `school`, `isCashReceipt`.
- **Fee** — `title`, `fee`, `class_info`; **unique** (class_info,title); section-priority.
- **LedgerPosting** — `date`, AY, EY, `remarks`, `months`(JSON), `class_info`.
- **StudentLedger** _(charge)_ — `date`, AY, EY, `remarks`, `student`, `school`,
  `details`(JSON `{title_id:amount}`+`__titles`), `ledger_posting`, `total`.
- **StudentInvoice** _(payment)_ — `invoice_id` (receipt no — a **per-school, per-academic-year
  serial that restarts at 1 each AY**, computed as max+1), `date`, `details`(JSON),
  `total_paid` (discount NOT pre-subtracted), `total_due`(opt), `total_discount`(opt),
  `payment_month`, `mode`, `remarks`, AY, EY, `extra_info`, `student`(opt),
  `class_info`(opt snapshot), `isCashReceipt`(indexed), `school`.
- **CashReceiptTitle** — `title`, `school`.

### 4.8 Staff payroll

- **StaffLedger** — `date`, AY, EY, `remarks`, `staff`, `school`, `months`, `details`,
  `total`.
- **StaffInvoice** — `invoice_id`, `date`, `details`, `total_paid` (deduction
  PRE-subtracted), `total_due`(opt), `total_deduction`(opt), `payment_month`, `mode`,
  `remarks`, AY, EY, `extra_info`, `staff`, `school`.

### 4.9 Examinations

- **Exam** — AY, `name`, `inclusion`(opt), `attendance_inclusion`, `school`.
- **ExamSchedule** — `exam`, `start_time`, `end_time`, `schedule`(JSON), `class_info`.
- **GradingRules** — `school`, `type`, `rules`(JSON).
- **SubjectAssignment** — AY, `school`, `class_info`, `subject`, `students`(JSON).
- **ClassResult** — `exam`, `class_info`, `subject`, `criteria`(JSON), `published_date`(opt).
- **StudentResult** — `student`, `theory`(opt), `practical`(opt), `total`, `attendance`(opt),
  `inclusion`(opt), `result`, `absent`(opt), `class_result`, `position_in_section`(opt),
  `position_in_class`(opt).
- **ExtraActivity** (`name`, `school`); **ExtraActivityEntry** (`school`, `class_info`,
  `exam`, `student`, `extra_activities`(JSON)).
- **CharacterCertificate** — `serial_no`, `school`, `student`(opt), `data`(JSON snapshot).
- **Seat plan** (exam seating, anti-cheating):
  - **SeatPlanRoom** — `exam`, `school`, `name`, `benches`, `seats_per_bench`,
    `order_by` (Roll/Symbol/Name/Regd), `note`(opt). One physical room = a benches × seats grid.
  - **SeatPlanRoomClass** — `room`, `class_info`, `column` (which seat/side on each bench this
    class occupies), `order_by`(opt — per-class override of the room default).
  - **SeatAllocation** — `room`, `student`, `class_info`(snapshot at seating), `bench_no`,
    `column`, `sequence` (fill order). Persisted so a plan reprints verbatim and a result can
    be traced to where the student sat.

### 4.10 Homework

- **Homework** (`title`, `description`, `due_date`, `class_info`, `subject`, `staff`,
  `school`); **HomeworkFile**; **HomeworkSubmission** (`homework`, `student`,
  `submitted_date`, `status`, `remarks`); **HomeworkSubmissionFile**.

### 4.11 Attendance

- **ClassAttendance** (`date`, `class_info`, `teacher`(opt), `school`).
- **StudentAttendance** (`class_attendance`, `student`, `status`, `checked_in_at`,
  `checked_out_at`, `reason`).
- **StaffAttendance** (`date`, `staff`, `status`, `checked_in_at`, `checked_out_at`,
  `school`, `reason`).

### 4.12 Transport & alerts

- **BusStation** (`station`, `school`, `fee` Decimal 7,2, `latitude`/`longitude`(opt)).
- **BusTrackOnAlertInfo** (`bus_id`, `student_id`(opt)/`staff_id`(opt), rider lat/long,
  `alert_range`, `alerted_date`).

### 4.13 Communication

- **Notice** (`title`, `description`, `school`, `date`, `image`(opt) — push-only).
- **NewsEvent**/**NewsEventImage**; **CalendarEvent** (`start_date`/`end_date`, `type`,
  `color`, `description`, `school`).
- **SMSTemplate** (`type`, `school`, `template`).
- **NotificationHistory** (`school`, `recipient_role`, `recipient_id`, `title`, `body`,
  `data`(opt), `status`, `sent_at`).
- **NoticeSA** (`alt`, `file`).

### 4.14 Accounting (`accounting`)

- **AccountingLedger** (`name`, `ledger_group` 1–34, `address`(opt), `contact`(opt),
  `school`).
- **AccountingLedgerBalance** (`balance_type`, `opening_balance`, `ledger`,
  `economic_year`; unique pair).
- **BaseEntry** (Income/Expense/Journal/Contra) — `_voucher_id` (shown `KEY-n`:
  INV/EXV/JRV/CNV), `school`, `economic_year`, `date`, `remarks`; +`ledger`/`mode` where
  relevant.
- **BaseParticular** (lines) — `ledger`, `amount`, `remarks`, `entry`; Journal +`type` (Dr/Cr).

### 4.15 Library (`library`)

- **Library** (`school`, `name`, `address`(opt), `contacts`(opt), `preferences`(JSON)).
- **Book** (rich bibliographic record — see §11).
- **BookCopy** (id = accession no; `is_lost`, `is_damaged`).
- **BookIssue** (`school`, `student`(opt)/`staff`(opt), `book` copy, `issued_date`,
  `due_date`, `returned_date`(opt), `remarks`).

### 4.16 RFID / biometric (`rfid`)

- **Device** (`serial_number` unique, `alias`, `ip_address`, `firmware`, `push_version`,
  `device_type`, `push_comm_key`, `timezone_min`, `real_time`, `state`, `last_seen`, sync
  stamps, counters, `school`).
- **DeviceCommand** (`device`, `cmd_id` unique, `cmd_content`, `status`, …).
- **RFIDAttdUser** (`device`, `pin`, `card`, `student`(opt)/`staff`(opt); unique
  device,pin).
- **RFIDAttdLogs** (`user`(opt), `punch_time`, `status`, `verify`, `workcode`,
  `received_at`; unique user,time,status,verify).

### 4.17 Audit (`main`)

- **HistoryLog** (`user_type`+`user_id` generic FK, `school`(opt), `object_type`+
  `object_id` generic FK, `timestamp`, `action`, `changes`(JSON diff), `ip_address`).

### 4.18 Enumerations

- **Education level:** montessory, school, school(GOVT), pre-diploma, diploma, highschool,
  bachelor, master.
- **Grade:** play group, nursery, LKG, UKG, one … twelve. **Faculty:** science, management,
  education, arts, humanities, law. **Year** 1–4, **Semester** 1–10.
- **Gender:** male/female/others. **Marital:** unmarried/married.
- **Occupation, Ethnicity, Sport, Blood group:** fixed lists (`main/choices/`).
- **Student status:** running/passed out/dropped out. **Staff status:** employed/departed/
  retired/on leave. **Subject type:** compulsory/optional.
- **Payment mode (billing):** cash/bank/cheque/wallet. **(accounting):** Cash/Bank.
  **Balance type:** Dr/Cr.
- **SMS template:** Dues/Payment/Result/Attendance/Birthday. **Calendar:** Public Holiday/
  Exam/Result/Event Day/Vacation. **Notification status:** Sent/Failed/Stale Token.
  **Homework:** Received/Checked. **Grading type:** Number/Grading/Division.
- **RFID punch status:** check-in/check-out/break-out/break-in/OT-in/OT-out/punch.
  **Verify:** fingerprint/card/face/palm/barcode.
- **Default grade bands** (per-school configurable): %→GPA ≥90→4.0, 80→3.6, 70→3.2, 60→2.8,
  50→2.4, 40→2.0, 35→1.6, <35→0.0; letters A+/A/B+/B/C+/C/D/NG.
- **Accounting ledger groups (1–34):** each with natural side + category (Asset/Liability/
  Equity/Income/Expense) + cash-flow class (Operating/Investing/Financing). Full list in
  `accounting/constants/ledger_groups.py`.

### 4.19 Reserved keys & special billing titles

- **`__titles`** in invoice/ledger `details`: `{title_id:name}` snapshot — **skip when
  iterating titles**.
- **Special titles:** `tn` transportation, `od` old dues, `ob` opening balance,
  `discounts`, `lib_fine` library fine, `cfo` carry-forward-out (negative balancing entry in
  the old year; never collectable).
- **Invoice detail keys:** `amt`, `dis`, `due`, `tdsp` (tax %), `tdsa` (tax amt).

---

## 5. Foundation & academic setup

Configured by an Admin **before** day-to-day use; order matters.

- **School profile & branding** `/api/admins`, `/api/schools`, `/api/school/images`,
  `/api/public_profile` — identity, logos & signatures, public gallery/QR page,
  `preferences`/`education_levels` JSON, SMS/app/test toggles.
- **Years** `/api/economic_year`, `/api/academic_year`, `/api/assign/academic_year` —
  economic (billing) & academic (teaching) years; **AY mapping sets the running year per
  faculty key** (allows staggered roll-over). Years can be closed/reopened (§14).
- **Classes/courses/sections** `/api/classes` (+v2), `/api/courses`, `/api/sections`,
  `/api/classes/periods` — reusable course/section blocks (delete-guarded); a ClassInfo is
  the unique class tuple; ClassPeriod is the timetable (subject/teacher per period).
- **Subjects** `/api/subjects`, `/api/subjects/optional` — partitioned (Theory+Practical),
  compulsory/optional, optional-subject rosters; strongly delete-guarded.
- **Grading rules** `/api/exams/grading_rules` — per-school marks→grade/division mapping.
- **Transport stations** `/api/stations` — per-station fee + GPS; delete-guarded.

---

## 6. People & profiles

### 6.1 Students `/api/students` (+ satellites)

- Enrolment creates Student + GuardianInfo (+ optional OtherInfo, login account, medical/
  transport/discount). Captures identifiers (roll/symbol/registration/EMIS), documents
  (photo, birth certificate, NID, citizenship front/back), previous school, remarks.
- **Status lifecycle:** running → passed out / dropped out (drives rosters & promotion).
- **Mid-year class changes** supported; invoices snapshot the class at payment time.
- Satellites: **transportation** (`/students/transportations`), **discounts**
  (`/students/discounts`), **medical** (`/students/medical`), **bulk photos**
  (`/students/bulk-photos`) and the **pending-photo pool** (`/students/pending-photos`)
  where admins upload class photos and a teacher pairs each face to a name (the pool treats
  **all sections of a grade as one pool** — sibling `ClassInfo` rows sharing every grade
  field but `section`); **RFID card** recordable before any device exists.

### 6.2 Staff `/api/staffs`, `/api/staffs/roles`

- Reusable staff roles; identity, status, primary/secondary subjects, contacts, photo, and
  **OtherInfo** with the **salary structure** used by payroll; `permissions` JSON; optional
  login + RFID card.

### 6.3 Self-service (mobile)

- Students/staff log in (password or OTP), view their own profile/results/homework/
  attendance (`/api/attendance/me`)/notices, and receive push.

---

## 7. Academics & examinations

- **Exam setup** `/api/exams`, `/api/exams/schedule` — exams under an AY (with `inclusion`
  and `attendance_inclusion`); per-class subject→date schedule with times.
- **Subject assignment** `/api/subjects/optional` — optional-subject student roster.
- **Results** `/api/exams/results` (+v2), grading `/api/exams/grading_rules`:
  - Engine computes percentage → letter grade → grade point using school bands (code
    defaults); handles theory+practical, inclusion, attendance inclusion; pass/fail per
    subject; absent; **positions in section & class**.
  - Per-subject set in **ClassResult** (`criteria` JSON); per-student marks in
    **StudentResult**. **Publishing** sets `published_date` (hidden until then). A
    result-migration utility moves results across structures.
- **Extra-curricular** `/api/extra_activities`, `/api/extra_activities_entry` — graded
  co-curricular per student per exam.
- **Character certificates** `/api/character_certificate` (+search) — serial-numbered;
  fields snapshotted for stable reprints.
- **Seat plan** `/api/exams/seat-plan` (GET full plan for an exam; POST create a room +
  its classes; PUT update/replace; DELETE a room, cascading its classes/allocations) and
  `/api/exams/seat-plan/generate` (run the arrangement and persist allocations).
  - The generator fills each bench so **adjacent seats come from different classes**
    (anti-cheating); students within a class are ordered by the room's (or class's)
    `order_by` (roll/symbol/name/regd). Regenerate is **idempotent** (replaces prior
    allocations) and reports any **unseated** students (room ran out of benches).
- **Homework** `/api/homeworks`, `/api/homeworks/submission` — assign with files; students
  submit with files; status Received → Checked; teacher remarks.

---

## 8. Attendance & RFID

- **Manual:** class attendance `/api/attendance` (per class/day, per-student present/absent
  - reason; recording teacher stored), staff attendance `/api/attendance/staff`,
    self-report `/api/attendance/me`, search `/api/search/attendance(/staff)`.
- **Time policy** `/api/attendance/time-set` + school `time_set_required`/
  `attendance_in_time`/`attendance_out_time`: when enabled, the in-time is a present cutoff
  (a first punch after it is not auto-present).
- **RFID/biometric devices** (ZKTeco-style push, `/iclock/*`): `registry`, `ping`,
  `getrequest` (command polling), `cdata` (device pushes data), `devicecmd` (results).
  Devices are **pre-registered per school**. Admin APIs (`/rfid/*`): `devices`, `users`
  (device-user↔profile), `users/strip-zeros`, `logs`.
- **Punch → attendance rule:** **any punch in a day ⇒ present**; `checked_in_at` = earliest
  punch; `checked_out_at` = last punch (only if checkout tracking on and ≥1h after
  check-in). Maintenance commands: `backfill_attendance`, `sync_cards`, `strip_card_zeros`.

---

## 9. Fees, billing & dues

Student-finance side (distinct from accounting in §10).

- **Fee structure** `/api/fees`, `/api/fees/titles` — titles (with applicable months &
  `isCashReceipt`) and per-class amounts; **section-specific fee overrides generic**.
- **Billing/charges** `/api/ledgers` (+history, +manage), `/api/search/postings`,
  `/api/search/overall_student_ledgers` — a LedgerPosting charges a class for months,
  generating one StudentLedger per student with a discount-aware per-title breakdown +
  `__titles` snapshot. Mismatch search detects AY drift.
- **Payments/receipts** `/api/payments`, `/api/search/transactions` — StudentInvoice records
  per-title amounts, total paid, discount, due, optional tax, mode, month, and a **class
  snapshot** for correct attribution after class changes. **Discount nuance:** student
  invoice `total_paid` is _pre-discount_; staff invoice `total_paid` is _post-deduction_.
  **Cashier** is derived from the audit log. **Cash receipts** (`isCashReceipt`) are quick
  standalone receipts. **Receipt numbers** (`invoice_id`) are **per-school, per-academic-year
  serials that restart at 1 each year**.
- **Dues & discounts** `/api/dues`, `/api/classwiseolddues`, `/api/students/discounts`,
  `/api/payment_discount_report` — outstanding balances, class-wise old dues, standing
  per-title discounts (**academic-year-scoped**, so the same title can be re-discounted after
  the student is promoted).
- **Staff salary** `/api/staff_ledgers`, `/api/staff_payments` — accrual + payment (net of
  deductions).
- **Billing reports** — payment-vs-discount, overall income plan, class-wise old dues,
  remaining dues.

---

## 10. Accounting (double-entry)

Self-contained book-keeping (`/accounting/*`), separate from student billing.

- **Chart of accounts** `/accounting/ledgers` (+search) — ledgers in one of **34 groups**
  (each with natural side, category, cash-flow class); opening balances per ledger per year.
- **Vouchers** — Income (INV), Expense (EXV), Journal (JRV), Contra (CNV); header
  (auto-numbered `KEY-n`, dated, mode for income/expense) + particulars (ledger+amount+
  remarks; journal lines carry Dr/Cr). Accountant derived from audit log. Entry search.
- **Reports** `/accounting/reports/*` — ledger report (individual & group-wise), trial
  balance, profit & loss, balance sheet.
- **Year close** `/accounting/economic_year/closing` (+undo) — carries balances via
  `previous_ey` chain.

---

## 11. Library

`/library/*` — one or more **libraries** per school (with preferences: loan period, fine
rate); rich **book** bibliographic records (title/authors/ISBN/publisher/edition/subject/
keywords/call no/vendor/quantity); each **copy** is a `BookCopy` whose **id is the
accession number** (tracks lost/damaged); **search** to find a copy;
**circulation** (`books/issue`) to issue/**renew**/**return** to a student or staff with
issue/due/return dates and fines (via `lib_fine` title + preferences).

---

## 12. Communication

- **Notices** `/api/notices` — **push-only by design (no SMS fallback)**; delivered via the
  school FCM topic.
- **News & events** `/api/news_events` — richer, multi-image, public-facing.
- **Calendar** `/api/calendar_events` — typed, colour-coded date-range events.
- **SMS** `/api/sms`, `/api/sms/templates`, `/api/sms/send_bulk_sms`, `/api/sms/send_dues_sms`
  — per-school gateway; templates per purpose with placeholders; bulk + dues-targeted sends.
- **Push** `/api/notifications/send`, `/api/notifications/history` — FCM to students/staff;
  supports targeting **multiple recipients in one send** (real-time multi-recipient); every
  send recorded per device with status (incl. **Stale Token** for uninstalled apps).
  Commands: `pushtest`, `noticepushtest`, `subscribetopics`.
- **Org broadcasts** `/api/notices_sa` — vendor → all schools.

---

## 13. Dashboards, search & reports

- **Dashboard** `/api/dashboard`, `/api/dashboard/attendance-today`.
- **Stats** `/api/classwise_student_statistics`, `/api/<role>/upcoming_birthdays`.
- **Search suite** `/api/search/*` — students, staffs, fees (by grade), ledger postings,
  overall student ledgers, transactions, certificates, attendance (student & staff), plus
  integrity searches (invoices/ledgers AY mismatch) and ledger posting history.
- **Reports** — payment-vs-discount, overall income plan, class-wise old dues, remaining
  dues; accounting trial balance/P&L/balance sheet.
- **Audit log** — the automatic `HistoryLog` is the system-wide activity trail.

---

## 14. Year-end: closing & promotion

- **Academic-year closing** `/api/academic_year/closing` (+`/undo`): finalises selected
  classes — **promotes** students (guarded against AY-mapping drift), **carries forward
  outstanding dues** as next-year opening balance while writing a balancing **`cfo`** entry
  in the old year so it **nets to zero** (dues are _moved_, not duplicated), and marks the
  year `closed`. Helpers: `backfill_promotion_dues`, `check_ay_alignment`.
- **Accounting-year closing** `/accounting/economic_year/closing` (+undo) — carries balances
  via `previous_ey`.

---

## 15. Super admin & operations

- **Super Admin** `/auth/superadmins`, `/auth/superadmin/register`, `/auth/superadmin/signin`
  — provision/manage School Admins; **org broadcasts** `/api/notices_sa`; cross-tenant
  **ledger management** `/api/ledgers/manage`.
- **Database backup** `/api/backup` — DB backup; seed dump in repo (`smsysdb_*.dump`).
- **Monitoring** `/__live_usage__/` (CPU/memory/disk, media sizes, app status); Sentry both
  ends.

---

## 16. Complete API surface

> Auth: `Authorization: IGNITE <token>` or the `smsys` cookie; `/api`, `/accounting`,
> `/library`, `/rfid` admin routes require an authenticated, school-scoped token.

- **/auth:** signin, change_password, profile, account_update, obtain,
  {superadmin,admin,staff}/obtain, superadmins, superadmin/{register,signin}, admin/signin,
  student/{register,signin}, staff/{register,signin}, otp/{verify,resend}, logout.
- **/api setup:** academic_year, assign/academic_year, academic_year/closing(+/undo),
  economic_year, admins, schools, public_profile, school/images, classes, classes/periods,
  sections, courses, subjects, subjects/optional, stations, exams/grading_rules.
- **/api people:** students, students/{transportations,discounts,medical,bulk-photos,
  pending-photos}, staffs, staffs/roles.
- **/api academics:** exams, exams/{schedule,results,seat-plan,seat-plan/generate},
  extra_activities, extra_activities_entry, character_certificate, homeworks,
  homeworks/submission.
- **/api attendance:** attendance, attendance/{staff,me,time-set}.
- **/api finance:** fees, fees/titles, ledgers, ledgers/history, staff_ledgers,
  ledgers/manage, payments, staff_payments, dues, classwiseolddues,
  payment_discount_report, overall_income_plan_report.
- **/api comms:** notices, news_events, calendar_events, sms, sms/templates,
  sms/send_bulk_sms, sms/send_dues_sms, notifications/{send,history}, notices_sa,
  bus_alert_settings.
- **/api dashboards:** dashboard, dashboard/attendance-today, classwise_student_statistics,
  <role>/upcoming_birthdays.
- **/api search:** students, staffs, fees, postings, overall_student_ledgers, transactions,
  certificates, attendance(+/staff), invoices_academic_year_mismatch,
  ledgers_academic_year_mismatch.
- **/api ops:** backup. **v2:** classes, fees, exams/results.
- **/accounting:** economic_year(+/closing,+/undo), ledgers, {income,expense,journal,contra}
  \_entry, search/{ledgers,entries}, reports/{ledger_report,trial_balance,profit_loss,
  balance_sheet}.
- **/library:** libraries, books, books/{search,issue}.
- **/rfid (admin):** devices, users, users/strip-zeros, logs.
- **/iclock (device):** registry, ping, getrequest, cdata, devicecmd.

---

## 17. Threat model & security blueprint for the next system

> The next build aims to be _the most secure school platform_. This chapter is the security
> backbone for that rebuild. Items are **🔐 Security-next**.

### 17.1 Trust boundaries

1. **Tenant ↔ tenant** (school A must never see school B). _Highest priority._
2. **Role ↔ role within a tenant** (a teacher must not act as accountant/admin).
3. **User ↔ their own records** (a student sees only their data).
4. **Device ↔ backend** (an RFID device must not impersonate another school's device).
5. **Client ↔ server** (never trust client-supplied identifiers like `school` id).

### 17.2 Weaknesses in the current system (must fix)

- **🔐 Tenant id from client input.** The school id is read from query/body
  (`school`/`school_id`/`class_info.school`) and isolation depends on each view filtering.
  → **Derive tenant strictly from the authenticated principal**, never from request data.
  Add a base manager/queryset that auto-injects the tenant; make cross-tenant access an
  explicit, audited superadmin capability.
- **🔐 Permissions are UI-side.** `Staff.permissions` mainly gates the frontend.
  → **Enforce every permission server-side** (decorator/policy layer per endpoint); deny by
  default.
- **🔐 Long-lived tokens.** Tokens are reused (`get_or_create`) and only the cookie expires.
  → **Short-lived access tokens + refresh + rotation + server-side revocation**; bind tokens
  to device/session; rotate on privilege change.
- **🔐 Broad exception swallowing in auth.** The authenticator's school check uses
  `try/except` that can mask failures. → Make authz checks explicit, fail-closed, and tested.
- **🔐 OTP & login abuse.** No rate limiting/lockout visible. → Add throttling, lockout,
  and anomaly detection on login/OTP/password-reset.
- **🔐 Device protocol auth.** `/iclock/*` relies on serial/comm-key. → Mutually
  authenticate devices (per-device secret/cert), verify the device's school on every push,
  and reject logs for unregistered devices.

### 17.3 Target controls for the rebuild

- **AuthN:** Argon2 password hashing; MFA for Admin/Super Admin; WebAuthn option;
  OTP with strict expiry + rate limit; secure session cookies (`__Host-` prefix, SameSite,
  short TTL).
- **AuthZ:** centralized policy engine (RBAC + per-object/tenant checks); deny-by-default;
  object-level permission checks on every read/write; explicit, audited "act-as" for support.
- **Tenant isolation:** tenant derived from principal; row-level security (PostgreSQL RLS)
  as defence-in-depth; per-tenant encryption keys for sensitive fields if required.
- **Data protection:** encrypt PII at rest (medical info, documents, contacts); signed,
  expiring URLs for media (no public media root); field-level access control for medical/
  financial data.
- **Auditing:** immutable, append-only audit log (the current `HistoryLog` is a great base —
  make it tamper-evident, store actor/tenant/IP/user-agent, and add read-access logging for
  sensitive records).
- **Input & API:** strict serializer validation everywhere; typed OpenAPI contract;
  output encoding; CSRF protection for cookie-auth; CORS allow-list; security headers (HSTS,
  CSP, X-Content-Type-Options, Referrer-Policy).
- **Money integrity:** DB constraints + transactions for all financial writes; explicit
  ledger-line tables (not JSON) so balances are verifiable; double-entry invariants enforced
  at the DB.
- **Secrets & ops:** secrets in a vault (not `.env` in repo); least-privilege DB roles;
  automated, tested, encrypted backups; dependency scanning + SBOM; SAST/DAST in CI.
- **Privacy/compliance:** data-retention policies (RFID logs especially), data-subject
  export/delete, consent tracking for SMS/push, minor-data handling.
- **Monitoring:** Sentry + structured logs + alerting; intrusion detection on auth anomalies;
  health checks for DB/Redis/FCM/SMS.

### 17.4 Quick wins to carry over (already good here)

- Per-role token tables and role separation.
- Automatic field-level audit log with actor + IP.
- Soft delete + referential guards + protected subjects (data-loss prevention).
- Multi-tenant `school` scoping on every entity (foundation for RLS).
- Per-school SMS keys (no shared credential blast radius).

---

## 18. Product/architecture recommendations for the next system

(Functional/UX/architecture improvements beyond security — **🔧 Build-next**.)

1. **Dedicated Parent role** linked to one+ students (fees, attendance, results, push) —
   biggest UX win; today "student" doubles as the parent channel.
2. **Online payments** (gateway) auto-reconciling into invoices.
3. **Explicit financial ledger lines** instead of billing JSON (`cfo`/`ob`/`od`/discount/
   tax as rows) — far easier to report, reconcile, and audit.
4. **Store `created_by` on financial records** (don't derive cashier/accountant from audit
   log).
5. **One service for "current academic year"** (the AY mapping) so no code path guesses;
   keep the alignment checker as a scheduled job.
6. **DB constraints over conventions** (one present-record/student/day; AY/EY consistency on
   invoices & ledgers — the "mismatch search" tools exist because these drift today).
7. **Typed API contract** (OpenAPI) consumed by a generated frontend client; serializers on
   every endpoint.
8. **Background jobs** (Celery/RQ) for bulk SMS/push, year-end closing, backups, result
   recalculation — with progress + retry.
9. **Object storage** for media with signed URLs; stateless app.
10. **Report builder & branded PDF/Excel exports** (mark-sheets, receipts, ledgers,
    statements — the school's logos/signs are already stored).
11. **Bulk operations everywhere** (enrol, promote, fee assign, CSV marks import with
    validation previews).
12. **Admin-facing audit-log UI** ("who changed this") on every detail page.
13. **i18n** (BS/AD date toggle, English/Nepali UI).
14. **Notification center + per-category channel preferences** (keep push-only-notice as a
    default).
15. **Real test suite** around finance math, result calculation, year-end closing, and
    tenant isolation (current apps ship near-empty `tests.py`).

---

## 19. Business rules & invariants (preserve these in the rebuild)

> These are the **non-obvious rules** the current system enforces in scattered code. They
> are the hardest things to rediscover and the easiest to break. The rebuild should treat
> each as an explicit, **tested** invariant (ideally a DB constraint or a domain-service
> rule, not a convention).

### Identity & tenancy

- **I1.** Every tenant-owned record belongs to exactly one `school`; reads/writes must be
  filtered by the **authenticated** principal's school, never by a client-supplied id.
- **I2.** A login account maps 1:1 to exactly one profile (Admin↔SchoolAdmin,
  Staff↔Staff, Student↔Student). A profile may exist **without** an account.
- **I3.** Usernames are globally unique per role table; tokens are per-role (never shared).

### Academic structure

- **A1.** A `ClassInfo` is **unique** on its full class-detail tuple (education_level,
  grade, faculty, course, section, year, semester) within a school — no duplicate classes.
- **A2.** "Current academic year" is resolved through **AcademicYearMapping** (`key → AY`)
  per faculty group — **never** a single global flag. Different faculties may run different
  current years simultaneously (staggered).
- **A3.** Sections of the same grade share every grade field and differ **only** by
  `section`; features that act "per grade" (e.g. the photo pool) must union all sibling
  `ClassInfo` rows.

### Subjects

- **S1.** A subject **used or assigned anywhere** (results, homework, assignments, periods,
  staff primary/secondary, seat plan…) can **never** be deleted.
- **S2.** `Subject.is_protected = True` is a hard delete-lock even with **no** references.
- **S3.** A "partitioned" subject stores Theory **and** Practical in one record
  (`code`/`subject`/`credit_hours` + `code_pr`/`subject_pr`/`credit_hours_pr`).

### Money, billing & invoicing

- **M1.** **StudentInvoice.total_paid does NOT have discount pre-subtracted**; discount is
  tracked separately (`total_discount`). **StaffInvoice.total_paid HAS deductions
  pre-subtracted.** (The single most error-prone asymmetry — any report must respect it.)
- **M2.** `invoice_id` is a **per-school, per-academic-year serial** that restarts at 1 each
  AY (computed as max+1 within school+AY). It is **not** globally unique.
- **M3.** A `StudentInvoice` snapshots the student's **class at payment time**
  (`class_info`) so income is attributed to the class the student was in then, even after a
  mid-year class change.
- **M4.** Invoice/ledger `details` JSON carries a **`__titles`** snapshot of fee-title names
  at write time; readers must **skip `__titles`** when iterating titles, and must prefer the
  snapshot label over the live FeeTitle (which may be renamed/deleted).
- **M5.** Fee resolution honours **section priority**: a section-specific `Fee` overrides a
  generic class `Fee` for the same title.
- **M6.** `Fee` is **unique** on (class_info, title).
- **M7.** Billing JSON uses reserved non-fee titles: `tn` transport, `od` old dues,
  `ob` opening balance, `discounts`, `lib_fine`, `cfo` carry-forward-out. `cfo` is a
  **negative balancing entry** and is never a collectable bill.
- **M8.** A billing run = one `LedgerPosting` → many `StudentLedger` rows (one per student),
  each with a discount-aware per-title breakdown.

### Discounts

- **D1.** A standing discount is either a flat `discount` **or** a `percentage`.
- **D2.** Discounts are **academic-year-scoped** (`academic_year`), so the same fee title
  can be discounted again after promotion; reports group discounts by year.

### Year-end (closing & promotion)

- **Y1.** Closing **promotes** eligible students and **moves** (not duplicates) outstanding
  dues: the carried amount becomes an **opening balance (`ob`)** in the new year, and a
  **`cfo`** (negative) entry is written in the **old** year so the old year **nets to zero**.
- **Y2.** Promotion is **guarded** so a class only rolls within its own running-year context
  (respects the AY mapping); an alignment checker detects drift.
- **Y3.** Closing is reversible (**undo**).

### Attendance

- **AT1.** **Any RFID punch in a day ⇒ that person is present that day.**
- **AT2.** `checked_in_at` = **earliest** punch of the day; `checked_out_at` = **last**
  punch, recorded **only** if the school enables checkout tracking **and** it is **≥1 hour**
  after check-in.
- **AT3.** If `time_set_required` is on, a **first** punch **after** `attendance_in_time` is
  **not** auto-marked present.
- **AT4.** RFID devices must be **pre-registered per school**; logs from unknown devices are
  rejected. Raw punches dedupe on (user, punch_time, status, verify).

### Exams, results & seating

- **E1.** Results are **hidden** until `ClassResult.published_date` is set.
- **E2.** Result calc derives percentage → letter grade → grade point from the school's
  **GradingRules** (with code defaults), and computes **positions** in section and class.
- **E3.** Seat plan generation seats **adjacent seats from different classes**
  (anti-cheating), orders students within a class by `order_by`, is **idempotent** on
  regenerate, snapshots the student's class, and reports **unseated** students.

### Deletion & audit

- **X1.** Default deletion is **soft** (`is_active = False`); lists show active only.
- **X2.** Referential guards block deleting referenced **Bus Station**, **Course**,
  **Section** (and subjects per S1/S2).
- **X3.** Create/update auto-write a `HistoryLog` with actor, school, **field-level diff**,
  and IP. Cashier (invoice) and accountant (voucher) identity are **derived from this log**
  today — the rebuild should instead store `created_by` explicitly (see §18.4).

---

## 20. Appendix: running the reference implementation

> Condensed operational notes for the existing codebase (previous content of this file).
> The new system will supersede this with its own setup docs. **Keep this document local —
> it is not pushed to GitHub.**

**Repo layout** (`/home/acer/Desktop/Django/Cent-New`):

- `smsys.backend/` — Django backend (apps `account`, `main`, `accounting`, `library`,
  `rfid`, `monitor`; project in `backend/`; helpers in `customs/`; docs in `docs/`).
- `smsys/` — Next.js frontend.
- `smsysdb_*.dump` — PostgreSQL seed dump.
- `codechanges.md`, `dbchanges.md`, `queries.md` — historical change/query notes.

**Run (dev):**

```bash
# Backend (from smsys.backend, venv active)
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
# Frontend (from smsys)
npm install && npm run dev   # http://localhost:3000
```

PostgreSQL must be running; backend env `smsys.backend/.env`, frontend `smsys/.env.local`.

**Production:** Gunicorn; project path `/root/home/centit/projects/smsys.backend`; served as
`backend.nirsabi.com`; reload the gunicorn service after deploy.

**Live API docs:** Swagger `/api/docs/`, ReDoc `/api/redoc/`.

**Management commands:** `backfill_attendance`, `sync_cards`, `strip_card_zeros` (rfid);
`backfill_promotion_dues`, `check_ay_alignment`, `pushtest`, `noticepushtest`,
`subscribetopics` (main).

## 21. Post-audit parity additions (2026-07, rebuild)

Modules the legacy system grew after this spec was frozen, ported with their
rules intact; invariants continue the §19 numbering.

- **Education Equality Fee (शिक्षा समता शुल्क)** — Nepal FY 2083/84's 3% levy.
  - **T1**: the fee is a government PASS-THROUGH — snapshotted on the payment
    (`edu_fee_pct/base/amount`), never inside `total_paid`, dues, or revenue.
  - **T2**: opt-IN per (school, education level), vendor-managed
    (`billing.EducationFeeLevel`); no rows = off. Regular receipts only.
  - **T3**: base = Σ(amount − discount) over positive-net lines, the DISCOUNT
    pseudo-line excluded (its amounts already netted per line); old dues,
    opening balances, transport and fines ARE taxable; 3% ROUND_HALF_UP.
  - Receipts print the levy + grand total; the daily-collection SMS appends
    "Equity Fee Payable" only for enabled schools.
- **Batches (cohorts)** — the intake is a student's immutable identity
  (`academics.Batch`, unique per school+course+admission year); the class
  tuple gains the batch dimension so two intakes can share a course+term.
  Exactly one of `current_semester`/`current_year` advances, and only via
  promotion. `Course.total_years`/`total_semesters` are mutually exclusive.
- **Program year-end (shared-clock programs)** — order is LAW:
  1. `rollover_program_year` closes the single AY, re-points the course's
     classes in place, and carries balances **per fee title** when the title
     sum equals the authoritative net with every title positive (juniors keep
     live dues under real titles) — else one opening-balance row. The carried
     total always equals the net.
  2. `promote_program` then moves levels up (same-AY move ⇒ no double-carry),
     section-preserving, terminal level frozen; batch counters advance.
- **Final results** — exams with `inclusion_weight` aggregate: weights scale
  marks AND full/pass marks identically, a missed exam contributes zero (no
  re-normalisation), absent means absent in every included exam, dense-rank
  on the final total. Same payload contract as a single exam.
- **Optional subjects** — `OptionalSubjectAssignment` presence narrows marks
  rosters; empty set = whole class (compulsory behaviour).
- **Outbound SMS** — every send goes through the provider abstraction
  (`settings.SMS_PROVIDER`, console default) and leaves a DeliveryLog row;
  nothing is ever marked sent without a provider hand-off.
- **Photo pool** — `people.PendingPhoto` is staging, never an archive:
  pairing writes `Student.photo` and hard-deletes the pool row + file.
- **Vendor surface** — splash announcements are any-principal by design;
  `HiddenEducationLevel` presence hides a level from that school's pickers.

---

_End of specification. Keep in sync with the system; when the next-level build diverges,
update the relevant section and mark legacy behaviour explicitly._
