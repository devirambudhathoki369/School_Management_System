# Competitive Roadmap — beating Veda (and the field) in Nepal

> Research date: 2026-07-02. Primary competitor: **Veda** (Ingrails) — 900+
> schools, 1.6M+ users, the reference product for Nepali school management.
> Sources: veda-app.com (home/about), eLearning Industry directory,
> OnlineKhabar coverage. This document ranks what we build after core parity
> so every sprint moves us past the market leader, not just up to it.

## 1. Where Veda is strong (gaps we must close)

| Veda feature                                                   | Status in our platform                       | Priority                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parent mobile app** (attendance, billing, progress, notices) | Guardian role exists in identity; no app yet | **P1** — legacy's biggest UX gap (doc §18.1); guardians are already first-class in our data model                                                                    |
| **Online fee payment** (eSewa/Khalti/FonePay gateways)         | Not built                                    | **P1** — revenue-critical; auto-reconcile into invoices (doc §18.2)                                                                                                  |
| **IRD-verified billing** (Nepal tax compliance)                | Not built                                    | **P1** — a hard sales blocker for private schools; design invoice numbering + immutability to IRD spec from day one (our transactional serial fix is the foundation) |
| Zoom-integrated online classes                                 | Not built                                    | P3 — commodity integration, add post-launch                                                                                                                          |
| Online subjective/objective exams (LMS-lite)                   | Marks-entry only (legacy parity)             | P2 — extends our examinations module                                                                                                                                 |
| Online admissions                                              | Not built                                    | P2 — public form → pending-student workflow                                                                                                                          |
| Bus tracking w/ parent push                                    | Legacy has proximity alerts; no parent push  | P2 — lands with transport + parent app                                                                                                                               |
| Founder's app (multi-school owner dashboard)                   | Foundation entity exists; no dashboard       | P2 — we model Foundation→Schools natively, so this is a view not a rewrite                                                                                           |
| Visitor records                                                | Not built                                    | P3                                                                                                                                                                   |

## 2. Where we already beat Veda (press these advantages)

1. **Security architecture.** Tenant isolation derived from the principal,
   deny-by-default per-module permissions on every CRUD action, short-lived
   rotating tokens, Argon2 — no Nepali competitor markets real security.
2. **True double-entry accounting** (trial balance, P&L, balance sheet)
   vs Veda Finance's bookkeeping; plus our billing↔accounting separation.
3. **RFID/biometric device integration** (ZKTeco push protocol) — automated
   hardware attendance, not just app check-ins.
4. **Exam seat planning** (anti-cheating adjacency algorithm) — unique.
5. **Bikram Sambat correctness end-to-end** with staggered per-faculty
   academic years (A2) — most products assume one global year.
6. **Data lineage.** Full audit log with field diffs + LegacyMap provenance
   for every migrated row.

## 3. Sequenced roadmap (after remaining legacy parity)

Legacy parity first — examinations, attendance, billing, accounting, library,
communication, transport, RFID (LEGACY_DATA_MAP.md phases 6–10) — because
migrating the 72 existing schools is the beachhead. Then:

1. **P1 wave (differentiate):** parent app (guardian logins + push),
   payment gateways with auto-reconciliation, IRD-compliant receipts.
2. **P2 wave (win deals):** online admissions, founder dashboard,
   LMS-lite (assignments++, online exams), bus tracking with parent push.
3. **P3 wave (polish):** Zoom/Meet integration, visitor log, i18n
   (Nepali UI), report builder with branded PDF exports.

Sources: [veda-app.com](https://veda-app.com/) ·
[About Veda](https://veda-app.com/about) ·
[eLearning Industry profile](https://elearningindustry.com/directory/elearning-software/veda-school-management-system) ·
[OnlineKhabar coverage](https://english.onlinekhabar.com/veda-software-school-management-nepal.html)
