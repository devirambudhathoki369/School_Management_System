# Legacy Data Map — `smsysdb` → New Platform

> **Purpose.** The authoritative mapping from the legacy CentEducation database
> (dump `smsysdb_full_2026-07-02_014009.sql.gz`, taken 2026-07-02) to the new
> platform's modules. This document drives the ETL: every legacy table is
> accounted for — migrated, transformed, or explicitly dropped. Companion to
> `DOCUMENTATION.md` (business rules) — rule IDs like **M2** refer to its §19.

---

## 1. Restored legacy instance (working copy)

The dump is restored locally into a dedicated, user-owned PostgreSQL 18 cluster
(no root required, independent of the system cluster on 5432):

|                  |                                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| Cluster data dir | `~/.local/share/school_management_pg`                                            |
| Port / socket    | `5433` / `/tmp`                                                                  |
| Database         | `smsys_legacy` (833 MB, 102 tables)                                              |
| Connect          | `psql -h /tmp -p 5433 -U acer -d smsys_legacy`                                   |
| Start            | `/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/share/school_management_pg start` |
| Stop             | `/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/share/school_management_pg stop`  |

⚠️ The cluster runs with `fsync=off` for import speed — it is a **disposable
working copy**. The `.sql.gz` dump remains the source of truth; never treat
this cluster as durable storage.

**Scale snapshot:** 72 schools (6 test accounts) · 68,269 students (46,494
running) · 2,411 staff · 2,473,167 exam results · 808,009 student-attendance
rows · 359,109 ledger rows · 202,039 invoices · 664,629 audit-log rows.

---

## 2. Data-quality findings (must shape the new design)

Verified against the restored data — these are facts, not guesses:

1. **Receipt serials are NOT unique (M2 is violated in production).**
   25,627 (school, academic-year, serial, kind) groups have duplicates —
   the legacy "max+1" computation races. **New system:** allocate serials from
   a per-(school, AY, series) counter row updated inside the payment
   transaction (`SELECT … FOR UPDATE`), with a DB unique constraint.
   **ETL:** import legacy `invoice_id` as display-only `legacy_serial`; do not
   enforce uniqueness on historical rows.
2. **4 journal vouchers are unbalanced** (Dr ≠ Cr). **New system:** enforce
   balance with a deferred DB constraint/trigger. **ETL:** import flagged
   `needs_review=true`; report to the school's accountant.
3. **192,459 of 202,039 invoices have `class_info` NULL** — the class snapshot
   (M3) was added late. **ETL:** backfill from the student's ledger context
   where derivable, else leave null; reports must tolerate null.
4. **Invoice `details` has two shapes:** 196,349 objects
   (`{title_id:{amt,dis,due,tdsp,tdsa}, __titles:{…}}`) and 5,690 arrays
   (`[{AMT, PAR}]`) — the array form is exactly the cash receipts
   (`isCashReceipt=true`, `student_id` NULL, payer in `extra_info`).
5. **2,933 of 6,044 student accounts are orphaned** (login exists, no student
   links back). **ETL:** migrate only linked accounts; export orphans to a
   review list.
6. **Auth tokens are live credentials** in the dump (per-role token tables).
   Never migrate; force fresh login on the new platform.
7. All "date" varchar(10) columns are **Bikram Sambat** strings
   (e.g. `2081-03-15`); `created_at`/`updated_at`/punch times are UTC.

---

## 3. Target module map

The new platform is a modular Django monolith; each module is a bounded
context with its own app. Cross-cutting: every tenant-owned row carries
`school_id` derived **from the authenticated principal** (never the client),
RLS as defence-in-depth, soft delete, append-only audit, `created_by` stored
explicitly on financial rows (backfilled from `main_historylog` during ETL).

| #   | Module (app)    | Owns                                                                                        |
| --- | --------------- | ------------------------------------------------------------------------------------------- |
| 1   | `identity`      | Unified accounts, sessions/refresh tokens, RBAC                                             |
| 2   | `tenants`       | School, foundation, shareholders, branding, settings, vendor broadcasts                     |
| 3   | `academics`     | Years, mappings, classes, courses, sections, subjects, periods                              |
| 4   | `people`        | Students + satellites, guardians, staff + roles                                             |
| 5   | `examinations`  | Exams, schedules, grading, results, seat plans, certificates, extra activities              |
| 6   | `homework`      | Homework, submissions, files                                                                |
| 7   | `attendance`    | Class/staff attendance, time policy                                                         |
| 8   | `billing`       | Fee titles, fees, postings, student ledgers, invoices (**explicit line tables**), discounts |
| 9   | `payroll`       | Staff ledgers & salary invoices                                                             |
| 10  | `accounting`    | Double-entry: ledgers, balances, **unified vouchers** + lines                               |
| 11  | `library`       | Libraries, books, copies, circulation                                                       |
| 12  | `transport`     | Bus stations, proximity alerts                                                              |
| 13  | `communication` | Notices, news, calendar, SMS, push history                                                  |
| 14  | `inventory`     | Categories, items, stock transactions _(exists in prod, absent from docs)_                  |
| 15  | `devices`       | RFID/biometric devices, device users, punch logs                                            |
| 16  | `audit`         | Append-only history log                                                                     |

---

## 4. Table-by-table mapping

Notation: **→** target entity · **T:** transformation · rows from the 2026-07-02 dump.

### 4.1 `identity` ← account tables

| Legacy table                            |  Rows | → Target                             | Notes                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----: | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_superadminaccount`             |     1 | `identity.Account(role=SUPER_ADMIN)` | T: unify all four role tables into one account model with a `role` field + per-role profile link. Usernames collide across role tables → new uniqueness is (role, username); keep `legacy_table`+`legacy_id`. Django password hashes import as-is; rehash to Argon2 on first login. |
| `account_adminaccount`                  |    73 | `identity.Account(role=ADMIN)`       | `sms_api` moves to `tenants.SchoolSettings` (it is tenant config, not credential-of-user).                                                                                                                                                                                          |
| `account_staffaccount`                  | 2,101 | `identity.Account(role=STAFF)`       | `app_device_token` → `identity.DeviceRegistration` (per-device row, supports multi-device).                                                                                                                                                                                         |
| `account_studentaccount`                | 6,044 | `identity.Account(role=STUDENT)`     | Migrate only the 3,111 linked ones; 2,933 orphans → review export.                                                                                                                                                                                                                  |
| `account_*authtoken` (×5)               |     — | **dropped**                          | Live credentials; new auth = short-lived access + refresh rotation.                                                                                                                                                                                                                 |
| `auth_user`, `auth_*`, `django_session` |     — | **dropped**                          | Django internals; superuser recreated on the new system.                                                                                                                                                                                                                            |
| `main_staff.permissions` (JSON)         |     — | `identity` RBAC tables               | T: JSON id-lists → `Role`/`Permission`/`AccountRole` rows; enforced server-side, deny-by-default (fixes §17.2).                                                                                                                                                                     |

### 4.2 `tenants` ← school/org tables

| Legacy table                      | Rows | → Target                                                               | Notes                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ---: | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_schooladmin`                |   72 | `tenants.School` + `tenants.SchoolSettings` + `tenants.SchoolBranding` | T: split the god-object — identity/PAN/contacts stay on `School`; `preferences`, `education_levels`, `uses_sms/uses_mobile_app/test_account`, attendance policy → `SchoolSettings` (typed columns, not JSON); logos/signs → `SchoolBranding`. BS dates (`estd_date`, `renew_date`) stored as `*_bs` text + converted `*_ad` date. |
| `main_schoolfoundation`           |    0 | `tenants.Foundation`                                                   | Schema-only (no prod rows).                                                                                                                                                                                                                                                                                                       |
| `main_shareholder`                |   25 | `tenants.Shareholder`                                                  | Already normalized in prod (docs still say JSON on foundation — doc drift).                                                                                                                                                                                                                                                       |
| `main_schoolimage`                |  132 | `tenants.SchoolImage`                                                  | Media files re-uploaded to object storage; paths remapped.                                                                                                                                                                                                                                                                        |
| `main_schoolhiddeneducationlevel` |  183 | `tenants.SchoolSettings.hidden_education_levels`                       | **Undocumented table.** Per-school hidden education-level list → array/child rows on settings.                                                                                                                                                                                                                                    |
| `main_splashnotice`               |    0 | `tenants.VendorAnnouncement`                                           | **Undocumented.** Vendor-level splash banner; merge concept with `main_noticesa` (0 rows) into one vendor-broadcast entity.                                                                                                                                                                                                       |

### 4.3 `academics`

| Legacy table               |  Rows | → Target                                                                      | Notes                                                                                                                                                            |
| -------------------------- | ----: | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_economicyear`        |     3 | `academics.BillingYear`                                                       | Global in legacy; keep global, rename to avoid confusion with accounting years.                                                                                  |
| `main_academicyear`        |   237 | `academics.AcademicYear`                                                      | Per-school; `closed` flag preserved (Y1–Y3).                                                                                                                     |
| `main_academicyearmapping` |   221 | `academics.CurrentYearPointer`                                                | **A2:** the only source of "current year", per faculty key. Exposed via one domain service.                                                                      |
| `main_course`              |    20 | `academics.Course`                                                            | Delete-guarded (X2).                                                                                                                                             |
| `main_section`             |   317 | `academics.Section`                                                           | Delete-guarded (X2).                                                                                                                                             |
| `main_classinfo`           | 2,270 | `academics.ClassInfo`                                                         | Unique on full tuple within school (A1) — enforce with a DB unique index (NULLs coalesced).                                                                      |
| `main_subject`             | 6,128 | `academics.Subject` (+ optional `SubjectComponent` rows for theory/practical) | T: partitioned theory/practical pairs (S3) → parent subject + component rows. `is_protected` (S2) preserved; S1 guard implemented as FK RESTRICT + domain check. |
| `main_classperiod`         | 2,799 | `academics.TimetableSlot`                                                     | T: `subjects`/`teachers` parallel JSON arrays → one row per period with subject FK + teacher FK.                                                                 |
| `main_subjectassignment`   |   239 | `academics.OptionalSubjectEnrollment`                                         | T: `students` JSON roster → one row per (student, subject, AY).                                                                                                  |

### 4.4 `people`

| Legacy table                     |   Rows | → Target                                          | Notes                                                                                                                                                                                                                           |
| -------------------------------- | -----: | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_student`                   | 68,269 | `people.Student` + `people.StudentDocument`       | Documents (photo/birth cert/NID/citizenship) → child rows in object storage with signed URLs; `rfid_card` normalized (strip leading zeros — legacy had a command for this); `birth_date` BS→ +AD column. PII encrypted at rest. |
| `main_studentguardianinfo`       | 68,383 | `people.Guardian` + `people.StudentGuardian`      | T: flatten father/mother/guardian columns → one `Guardian` row per person, linked with `relation`; enables the **Parent role** (§18.1) with one guardian ↔ many students. 114 rows are unreferenced → review list.              |
| `main_studentotherinfo`          |  7,178 | merge into `people.Student`                       | Ethnicity/sport/blood group as nullable typed columns — the 1:1 satellite adds nothing.                                                                                                                                         |
| `main_studentmedicalinfo`        |      1 | `people.StudentMedicalRecord`                     | Field-level encryption + read-access logging (§17.3).                                                                                                                                                                           |
| `main_studenttransportationinfo` | 23,101 | `transport.RiderSubscription`                     | Moves to transport module (it is a transport concern). ✅ 23,101 imported (2,456 soft-deleted preserved, 116 station-less).                                                                                                                                                                          |
| `main_studentdiscountinfo`       | 19,864 | `billing.StandingDiscount`                        | AY-scoped (D2); flat XOR percentage → DB check constraint (D1).                                                                                                                                                                 |
| `main_pendingstudentphoto`       |  5,833 | `people.PendingPhoto`                             | Grade-pool behaviour (A3) preserved; hard-delete on pairing.                                                                                                                                                                    |
| `main_staffrole`                 |     28 | `people.StaffRole`                                |                                                                                                                                                                                                                                 |
| `main_staff`                     |  2,411 | `people.Staff`                                    | `permissions` JSON → `identity` RBAC (see 4.1).                                                                                                                                                                                 |
| `main_staffotherinfo`            |  2,411 | `people.StaffProfile` + `payroll.SalaryStructure` | T: split — bio fields to profile; `basic_salary/grade/allowance/extra/insurance/pf_contrib/pan_no` to payroll (salary history becomes versionable). ✅ 741 structures imported (all-zero rows without a PAN = "not on payroll", skipped).                                                                             |

### 4.5 `examinations`

| Legacy table                                         |       Rows | → Target                                                             | Notes                                                                                                                              |
| ---------------------------------------------------- | ---------: | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `main_exam`                                          |        464 | `examinations.Exam`                                                  |                                                                                                                                    |
| `main_examschedule`                                  |      2,185 | `examinations.ExamScheduleEntry`                                     | T: `schedule` JSON (subject→date/time) → one row per subject sitting.                                                              |
| `main_gradingrules`                                  |        287 | `examinations.GradingScheme` + `GradeBand`                           | T: `rules` JSON → band rows with (min%, letter, GPA); check constraints for non-overlap.                                           |
| `main_classresult`                                   |     44,569 | `examinations.SubjectResultSheet`                                    | `criteria` JSON → typed columns (full/pass marks theory & practical…). `published_date` gates visibility (E1).                     |
| `main_studentresult`                                 |  2,473,167 | `examinations.StudentSubjectResult`                                  | Largest table — partition by academic year; bulk `COPY` ETL. Positions (E2) preserved as-imported, recomputable by the new engine. |
| `main_extraactivity`                                 |         24 | `examinations.ActivityDefinition`                                    |                                                                                                                                    |
| `main_extraactivityentry`                            |      4,687 | `examinations.ActivityGrade`                                         | T: `extra_activities` JSON → one row per (activity, grade).                                                                        |
| `main_charactercertificate`                          |      2,557 | `examinations.CharacterCertificate`                                  | `data` JSON snapshot kept verbatim (stable reprints).                                                                              |
| `main_seatplanroom` / `roomclass` / `seatallocation` | 3 / 7 / 44 | `examinations.SeatPlanRoom` / `SeatPlanRoomClass` / `SeatAllocation` | Near-1:1; E3 invariants live in the generator service.                                                                             |

### 4.6 `homework`

| Legacy table                       |          Rows | → Target                                   | Notes                   |
| ---------------------------------- | ------------: | ------------------------------------------ | ----------------------- |
| `main_homework` / `homeworkfile`   | 6,459 / 1,369 | `homework.Homework` / `HomeworkAttachment` | Files → object storage. ✅ 6,459 + 1,369 imported (legacy media paths preserved in FileField; media rsync pending). |
| `main_homeworksubmission` (+files) |             0 | `homework.Submission` (+files)             | Schema-only.            |

### 4.7 `attendance`

| Legacy table             |    Rows | → Target                             | Notes                                                                                                                    |
| ------------------------ | ------: | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `main_classattendance`   |  27,926 | `attendance.ClassAttendanceSession`  |                                                                                                                          |
| `main_studentattendance` | 808,009 | `attendance.StudentAttendanceRecord` | Partition by AY. **DB constraint:** one record per (student, date) (§18.6). AT1–AT3 live in the punch-ingestion service. |
| `main_staffattendance`   |   4,083 | `attendance.StaffAttendanceRecord`   | Same one-per-day constraint.                                                                                             |

### 4.8 `billing` — the big JSON→relational rewrite (§18.3)

| Legacy table            |    Rows | → Target                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------: | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_feetitle`         |     930 | `billing.FeeTitle`                        | `months` JSON → int-array column; `isCashReceipt` → `kind` enum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `main_cashreceipttitle` |       0 | merged into `FeeTitle(kind=CASH_RECEIPT)` |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `main_fee`              |   8,100 | `billing.FeeSchedule`                     | Unique (class_info, title) (M6); section-priority resolution (M5) in the fee-resolution service.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `main_ledgerposting`    |  83,177 | `billing.ChargeBatch`                     | `months` JSON → int array.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `main_studentledger`    | 359,109 | `billing.Charge` + `billing.ChargeLine`   | **T:** each `details` key → one line. Real title ids → `line_type=FEE` + FK + label from `__titles` snapshot; reserved keys → typed lines: `tn`→TRANSPORT, `od`→OLD_DUES, `ob`→OPENING_BALANCE, `discounts`→DISCOUNT, `lib_fine`→LIBRARY_FINE, `cfo`→CARRY_FORWARD_OUT (negative, never collectable, M7). Skip `__titles` when iterating (M4). DB check: sum(lines) = total. Soft-delete flags preserved (13,329 legacy-deleted rows; ETL re-run self-heals the flags).                                                                                                                                                                                |
| `main_studentinvoice`   | 202,039 | `billing.Payment` + `billing.PaymentLine` | **T (object form, 196,349):** per-title `{amt,dis,due,tdsp,tdsa}` → line columns (amount, discount, due_after, tax_pct, tax_amt). **T (array form, 5,690 = cash receipts):** `[{AMT,PAR}]` → free-text lines; payer from `extra_info` → `payer_name`/`payer_address`. **M1 preserved:** `total_paid` is pre-discount — document on the column. Legacy serial → `legacy_serial` (non-unique, finding #1); new payments get transactional serials. `created_by` backfilled from `main_historylog`. Null `class_info` backfilled where derivable (finding #3). Soft-delete flags preserved (4,899 legacy-deleted rows; ETL re-run self-heals the flags). |

### 4.9 `payroll`

| Legacy table        | Rows | → Target                        | Notes                                                                                                                                                         |
| ------------------- | ---: | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_staffledger`  |  736 | `payroll.SalaryAccrual` + lines | Same JSON→lines treatment. ✅ Imported: `details` keys are only the four heads (salary/grade/allowance/extra); 5 breakdown-less rows → single salary line; line sums == total on all 736; 22 soft-deleted rows preserved. |
| `main_staffinvoice` |  543 | `payroll.SalaryPayment` + lines | **M1 asymmetry:** `total_paid` here is post-deduction — normalized as `gross`/`tds`/`pf`/`insurance`/`net_paid` with a DB check (`net = gross - deductions`). ✅ Imported & reconciled: net NPR 18,749,427.31, TDS 109,871.89; verified `sum(amt) - sum(tdsa) == total_paid` on every row; `pf_deduction`/`insurance_deduction` are all zero in prod; `invoice_id` has 112 dup (school, serial) groups → display-only `legacy_serial`, new serials from a FOR-UPDATE counter per (school, **economic year** — the legacy fix keys receipts on EY, not AY); `extra_info.tds_percent` → column; `created_by` mined from historylog (ct 48, 100% resolved). |

### 4.10 `accounting`

| Legacy table                                      |                      Rows | → Target                     | Notes                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------: | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounting_accountingeconomicyear`               |                        37 | `accounting.FiscalYear`      | `previous_ey` chain preserved (year close). ✅ Imported (30 schools; names unique per school).                                                                                                                                                                                                                     |
| `accounting_accountingledger`                     |                     1,444 | `accounting.LedgerAccount`   | Group 1–34 → FK to a seeded `LedgerGroup` reference table (natural side, category, cash-flow class). ✅ Imported (all active, all groups in range).                                                                                                                                                            |
| `accounting_accountingledgerbalance`              |                     1,455 | `accounting.OpeningBalance`  | Unique (ledger, fiscal_year). ✅ Imported & reconciled: NPR 92,686,962.14 exact.                                                                                                                                                                                                                                   |
| `accounting_{income,expense,journal,contra}entry` |   876 / 1,527 / 2,883 / 0 | `accounting.Voucher(type=…)` | **T: unify 4 entry tables** into one voucher table; per-type serial preserved (`INV-n`/`EXV-n`/`JRV-n`/`CNV-n`) via per-(school, FY, type) FOR-UPDATE counters. `created_by` backfilled from audit log. ✅ 5,286 imported: legacy serials verified duplicate-free → kept real, counters seeded from maxima (47); creators 100% (ct 56/57/58); soft-deletes preserved (24/21/48); `legacy_id` unique per TYPE (the 4 entry tables had independent id sequences).                                                                    |
| `accounting_*particular`                          | 5,014 / 4,233 / 9,180 / 0 | `accounting.VoucherLine`     | Every line gets an explicit Dr/Cr side (derived once at write time from the ledger group's category for income/expense — the legacy IE_TYPES report-time rule — and from `type` for journal). **DB constraint: voucher balances** (deferred trigger, `needs_review=true` exempts). ✅ 18,443 lines: journal reconciles exactly (NPR 909,379,985.84); the legacy income/expense header ledger is kept as `cash_ledger` + its balancing particular; 16 soft-deleted entries missing that balancing line got it synthesized; 22 vouchers flagged `needs_review` (4 unbalanced journals — finding #2 — 16 synthesized, 2 side-derivation imbalances). Legacy trial balance dropped opening-only ledgers from its totals — corrected in the port. |

### 4.11 `library`

| Legacy table                              |      Rows | → Target                             | Notes                                                                     |
| ----------------------------------------- | --------: | ------------------------------------ | ------------------------------------------------------------------------- |
| `library_library`                         |         6 | `library.Library`                    | `preferences` JSON → typed columns (observed keys: fine_per_day, fine_on_damage, shared_to → `shared_with` FK). ✅ 6 imported.                |
| `library_book` / `bookcopy` / `bookissue` | 0 / 0 / 0 | `library.Book` / `BookCopy` / `Loan` | Schema-only; copy id = accession number preserved as a field (unique per school), not the PK. ✅ |

### 4.12 `transport`

| Legacy table               |  Rows | → Target                   | Notes                                                                      |
| -------------------------- | ----: | -------------------------- | -------------------------------------------------------------------------- |
| `main_busstation`          | 1,215 | `transport.BusStation`     | Delete-guarded (X2). ✅ Imported.                                                       |
| `main_bustrackonalertinfo` |   476 | `transport.ProximityAlert` | Ephemeral operational data — migrate for continuity, add retention policy. ✅ 476 imported (no school column in legacy — derived from subscriber). |

### 4.13 `communication`

| Legacy table                        |    Rows | → Target                          | Notes                                                        |
| ----------------------------------- | ------: | --------------------------------- | ------------------------------------------------------------ |
| `main_notice`                       |     277 | `communication.Notice`            | Push-only by design — keep as default channel pref (§18.14). ✅ 277 imported. |
| `main_newsevent` / `newseventimage` | 17 / 26 | `communication.NewsPost` / images |                                                              |
| `main_calendarevent`                |     459 | `communication.CalendarEvent`     |                                                              |
| `main_smstemplate`                  |     149 | `communication.MessageTemplate`   |                                                              |
| `main_notificationhistory`          |   6,166 | `communication.DeliveryLog`       | Recipient (role, id) → FK to unified `identity.Account`. ✅ 6,166 imported, 100% recipient-matched; attendance `students_checked_in` now queues rows here.     |
| `main_noticesa`                     |       0 | `tenants.VendorAnnouncement`      | Merged with splash notice (4.2).                             |

### 4.14 `inventory` — **undocumented production module**

| Legacy table                | Rows | → Target                     | Notes                                                                                                                        |
| --------------------------- | ---: | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `main_inventorycategory`    |    2 | `inventory.Category`         | Nearly-unused in prod but live — must survive.                                                                               |
| `main_inventoryitem`        |    1 | `inventory.Item`             | `unit`, `reorder_level` kept. ✅                                                                                                |
| `main_inventorytransaction` |    2 | `inventory.StockTransaction` | `txn_type` int → enum (verified vs Cent-New: purchase +, issue −, wastage −, adjustment signed); stock is a derived signed sum. ✅ Imported. |

### 4.15 `devices` (RFID)

| Legacy table         |   Rows | → Target                | Notes                                                                                           |
| -------------------- | -----: | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `rfid_device`        |     14 | `devices.Device`        | Add per-device secret for mutual auth (§17.2); school pre-registration enforced (AT4).          |
| `rfid_devicecommand` | 19,020 | `devices.DeviceCommand` | Migrate recent only (retention: 90 days) — command queue is operational, not historical.        |
| `rfid_rfidattduser`  |  3,496 | `devices.DeviceUser`    | Unique (device, pin) preserved.                                                                 |
| `rfid_rfidattdlogs`  | 32,001 | `devices.PunchLog`      | Dedupe key (user, time, status, verify) → DB unique. Retention policy required (§17.3 privacy). |

### 4.16 `audit`

| Legacy table       |    Rows | → Target           | Notes                                                                                                                                                                                                                                                                |
| ------------------ | ------: | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main_historylog`  | 664,629 | `audit.AuditEvent` | Append-only, partitioned by month, tamper-evident (hash chain). Generic (user*type, user_id) → unified account FK via the identity id-map. **ETL sequencing:** also mined to backfill `created_by` on payments/vouchers \_before* being archived into the new table. |
| `django_admin_log` |      12 | **dropped**        | Django internal.                                                                                                                                                                                                                                                     |

---

## 5. ETL execution order

Dependency-safe phases; each phase is one idempotent, resumable Celery-run
(or management command) reading from `smsys_legacy` (5433) and writing to the
new DB, keeping a `legacy_map(legacy_table, legacy_id, new_table, new_id)`
cross-walk table used by every later phase and kept for support queries.

1. Reference data: ledger groups, enum seeds.
2. `tenants` (schools, settings, shareholders) — everything scopes to it.
3. `identity` (accounts + RBAC from permissions JSON; skip orphans/tokens).
4. `academics` (years → mappings → courses/sections → classinfo → subjects → periods).
5. `people` (guardians → students → satellites → staff).
6. `examinations`, `homework`, `attendance` (bulk `COPY` for the two giants).
7. `billing`/`payroll` (titles → fees → charge batches → charges+lines →
   payments+lines) with `created_by` mined from `main_historylog`.
8. `accounting` (fiscal years → ledgers → balances → unified vouchers+lines).
9. `library`, `transport`, `communication`, `inventory`, `devices`.
10. `audit` archive import.
11. **Reconciliation gate:** row counts per school, sum-of-lines = totals,
    dues per student (old system vs new), trial balance per school/FY —
    all must match before cutover. Media files re-uploaded separately.

**Not migrated:** auth tokens (×5 tables), `django_session`, `auth_*`,
`django_admin_log`, `django_migrations`, `django_content_type`.

---

## 6. Documentation drift to fold back into `DOCUMENTATION.md`

- **Inventory module** (`main_inventory*`) exists in production — undocumented.
- **`main_shareholder`** is a real table; docs still describe shareholders as JSON on the foundation.
- **`main_schoolhiddeneducationlevel`** — per-school education-level hiding, undocumented.
- **`main_splashnotice`** — vendor splash banner, undocumented.
- **M2 must be rewritten:** receipt serials are _intended_ to be unique per school+AY but are not in practice; the rebuild makes uniqueness real (new rows only).
