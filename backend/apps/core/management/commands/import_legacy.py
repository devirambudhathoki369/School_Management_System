"""
ETL: import the legacy smsysdb into the new platform.

Reads the restored legacy database (see LEGACY_DATA_MAP.md §1) and writes
new-platform rows, recording every migrated row in core.LegacyMap so the
command is idempotent (re-runs skip whatever is already imported) and later
phases can resolve foreign keys.

Phases (dependency order): tenants -> academics -> people.
Legacy auth tokens are never imported; password hashes are (PBKDF2 verifies
under Django and upgrades to Argon2 on first login).

Usage:
    python manage.py import_legacy                 # all phases
    python manage.py import_legacy --phase tenants
"""

import psycopg
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from apps.academics.models import (
    AcademicYear,
    ClassInfo,
    Course,
    CurrentYearPointer,
    Section,
    Subject,
)
from apps.core.models import LegacyMap
from apps.examinations.models import (
    ActivityDefinition,
    ActivityGrade,
    CharacterCertificate,
    Exam,
    ExamScheduleEntry,
    GradeBand,
    GradingScheme,
    StudentSubjectResult,
    SubjectResultSheet,
)
from apps.identity.models import Account, Role
from apps.people.models import Guardian, Staff, StaffRole, Student, StudentGuardian
from apps.tenants.models import School, SchoolBranding, SchoolSettings, Shareholder

# ---------------------------------------------------------------------------
# Legacy integer-choice mappings (verified against Cent-New source)
# ---------------------------------------------------------------------------

GENDER = {1: "male", 2: "female", 3: "others"}
STUDENT_STATUS = {1: "running", 2: "passed_out", 3: "dropped_out"}
STAFF_STATUS = {1: "employed", 2: "departed", 3: "retired", 4: "on_leave"}
EDUCATION_LEVEL = {
    1: "montessori", 2: "school", 10: "school_govt", 8: "pre_diploma",
    9: "diploma", 3: "highschool", 4: "bachelor", 5: "master",
}
GRADE = {
    16: "play_group", 1: "nursery", 2: "lkg", 3: "ukg", 4: "one", 5: "two",
    6: "three", 7: "four", 8: "five", 9: "six", 10: "seven", 11: "eight",
    12: "nine", 13: "ten", 14: "eleven", 15: "twelve",
}
FACULTY = {1: "science", 2: "management", 3: "education", 4: "arts", 5: "humanities", 6: "law"}
SUBJECT_TYPE = {1: "compulsory", 2: "optional"}
OCCUPATION = {
    0: "", 1: "teacher", 2: "doctor", 3: "engineer", 4: "lawyer",
    5: "government employee", 6: "house wife", 7: "farmer", 8: "driver",
}
BLOOD_GROUP = {0: "", 1: "A+", 2: "A-", 3: "B+", 4: "B-", 5: "AB+", 6: "AB-", 7: "O+", 8: "O-"}
ETHNICITY = {
    0: "", 1: "chhetri", 2: "brahmin", 3: "magar", 4: "tharu", 5: "tamang",
    6: "newar", 7: "kami", 8: "muslim", 9: "yadav", 10: "rai", 11: "gurung",
    12: "damai/dholi", 13: "thakuri", 14: "limbu", 15: "sarki",
}

BATCH = 2000


class IdMap:
    """In-memory legacy_id -> new_id map for one legacy table."""

    def __init__(self, legacy_table: str):
        self.legacy_table = legacy_table
        self.map = dict(
            LegacyMap.objects.filter(legacy_table=legacy_table)
            .values_list("legacy_id", "new_id")
        )

    def __contains__(self, legacy_id):
        return legacy_id in self.map

    def __getitem__(self, legacy_id):
        return self.map[legacy_id]

    def get(self, legacy_id, default=None):
        return self.map.get(legacy_id, default)

    def record(self, pairs: list[tuple[int, object, str]]):
        """pairs: (legacy_id, new_id, new_table)."""
        LegacyMap.objects.bulk_create(
            [
                LegacyMap(
                    legacy_table=self.legacy_table, legacy_id=lid,
                    new_table=table, new_id=nid,
                )
                for lid, nid, table in pairs
            ],
            batch_size=BATCH,
        )
        self.map.update({lid: nid for lid, nid, _ in pairs})


class Command(BaseCommand):
    help = "Import legacy smsysdb data (idempotent, phase by phase)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--phase",
            choices=[
                "all", "tenants", "academics", "people", "examinations",
                "attendance", "devices",
            ],
            default="all",
        )
        parser.add_argument(
            "--legacy-dsn",
            default=getattr(
                settings, "LEGACY_DB_DSN", "host=/tmp port=5433 dbname=smsys_legacy user=acer"
            ),
        )

    def handle(self, *args, **options):
        phase = options["phase"]
        with psycopg.connect(options["legacy_dsn"]) as legacy:
            if phase in ("all", "tenants"):
                with transaction.atomic():
                    self.import_tenants(legacy)
            if phase in ("all", "academics"):
                with transaction.atomic():
                    self.import_academics(legacy)
            if phase in ("all", "people"):
                with transaction.atomic():
                    self.import_staff(legacy)
                with transaction.atomic():
                    self.import_students(legacy)
            if phase in ("all", "examinations"):
                with transaction.atomic():
                    self.import_examinations(legacy)
                with transaction.atomic():
                    self.import_student_results(legacy)
            if phase in ("all", "attendance"):
                with transaction.atomic():
                    self.import_attendance(legacy)
            if phase in ("all", "devices"):
                with transaction.atomic():
                    self.import_devices(legacy)
        self.stdout.write(self.style.SUCCESS("Import finished."))

    # ------------------------------------------------------------------
    # Phase 1: tenants (+ admin accounts)
    # ------------------------------------------------------------------

    def import_tenants(self, legacy):
        schools = IdMap("main_schooladmin")
        accounts = IdMap("account_adminaccount")

        hidden_levels: dict[int, list[str]] = {}
        for school_id, level in self._rows(
            legacy, "SELECT school_id, education_level FROM main_schoolhiddeneducationlevel"
        ):
            hidden_levels.setdefault(school_id, []).append(EDUCATION_LEVEL.get(level, ""))

        rows = self._rows(legacy, """
            SELECT sa.id, sa.name, sa.address, sa.contact, sa.telephone, sa.email,
                   sa.pan_no, sa.estd_date, sa.test_account, sa.is_active,
                   sa.slogan, sa.about_us, sa.uses_sms, sa.uses_mobile_app,
                   sa.time_set_required, sa.attendance_in_time, sa.attendance_out_time,
                   a.id, a.username, a.password, a.verified
            FROM main_schooladmin sa JOIN account_adminaccount a ON a.id = sa.account_id
            ORDER BY sa.id
        """)

        created = 0
        for (lid, name, address, contact, telephone, email, pan_no, estd, is_test,
             active, slogan, about_us, uses_sms, uses_app, time_set, in_time,
             out_time, acc_id, username, password, verified) in rows:
            if lid in schools:
                continue
            if acc_id in accounts:
                account = Account.objects.get(id=accounts[acc_id])
            else:
                account = Account(
                    username=username, role=Role.ADMIN, password=password,
                    verified=verified, legacy_table="account_adminaccount", legacy_id=acc_id,
                )
                account.save()
                accounts.record([(acc_id, account.id, "identity_account")])

            school = School.objects.create(
                name=name, slug=self._unique_slug(name, lid), address=address or "",
                contact=contact or "", telephone=telephone or "", email=email or "",
                pan_no=pan_no or "", estd_date_bs=estd or "", is_test=is_test,
                is_active=active, admin_account=account, legacy_id=lid,
            )
            # The tenants post_save signal pre-creates empty satellites.
            SchoolSettings.objects.update_or_create(school=school, defaults={
                "uses_sms": uses_sms, "uses_mobile_app": uses_app,
                "time_set_required": time_set, "attendance_in_time": in_time,
                "attendance_out_time": out_time,
                "hidden_education_levels": [
                    x for x in hidden_levels.get(lid, []) if x
                ],
            })
            SchoolBranding.objects.update_or_create(school=school, defaults={
                "slogan": slogan or "", "about_us": about_us or "",
            })
            schools.record([(lid, school.id, "tenants_school")])
            created += 1

        for _lid, name, contact, school_lid in self._rows(
            legacy, "SELECT id, name, contact, school_id FROM main_shareholder"
        ):
            school_id = schools.get(school_lid)
            if school_id and not Shareholder.objects.filter(
                school_id=school_id, name=name or ""
            ).exists():
                Shareholder.objects.create(
                    school_id=school_id, name=name or "", contact=contact or ""
                )

        self._report("tenants", created, School)

    # ------------------------------------------------------------------
    # Phase 2: academics
    # ------------------------------------------------------------------

    def import_academics(self, legacy):
        schools = IdMap("main_schooladmin")
        years = IdMap("main_academicyear")
        courses = IdMap("main_course")
        sections = IdMap("main_section")
        classes = IdMap("main_classinfo")
        subjects = IdMap("main_subject")

        # Academic years
        new_rows = []
        for lid, name, start, end, school_lid, closed, remarks in self._rows(
            legacy,
            "SELECT id, name, start_date, end_date, school_id, closed, remarks"
            " FROM main_academicyear ORDER BY id",
        ):
            if lid in years or school_lid not in schools:
                continue
            new_rows.append(AcademicYear(
                school_id=schools[school_lid], name=name, start_date_bs=start or "",
                end_date_bs=end or "", closed=closed, remarks=remarks or "", legacy_id=lid,
            ))
        AcademicYear.objects.bulk_create(new_rows, batch_size=BATCH)
        years.record([(o.legacy_id, o.id, "academics_academicyear") for o in new_rows])

        # Year pointers
        for _lid, key, ay_lid, school_lid, prev_lid in self._rows(
            legacy,
            "SELECT id, key, academic_year_id, school_id, previous_academic_year_id"
            " FROM main_academicyearmapping",
        ):
            school_id, ay_id = schools.get(school_lid), years.get(ay_lid)
            if not (school_id and ay_id):
                continue
            CurrentYearPointer.objects.update_or_create(
                school_id=school_id, key=key,
                defaults={
                    "academic_year_id": ay_id,
                    "previous_academic_year_id": years.get(prev_lid),
                },
            )

        # Courses & sections
        new_rows = []
        for lid, name, school_lid, level in self._rows(
            legacy, "SELECT id, course, school_id, education_level FROM main_course ORDER BY id"
        ):
            if lid not in courses and school_lid in schools:
                new_rows.append(Course(
                    school_id=schools[school_lid], name=name,
                    education_level=EDUCATION_LEVEL.get(level, "school"), legacy_id=lid,
                ))
        Course.objects.bulk_create(new_rows, batch_size=BATCH)
        courses.record([(o.legacy_id, o.id, "academics_course") for o in new_rows])

        new_rows = []
        for lid, name, school_lid in self._rows(
            legacy, "SELECT id, section, school_id FROM main_section ORDER BY id"
        ):
            if lid not in sections and school_lid in schools:
                new_rows.append(Section(
                    school_id=schools[school_lid], name=name, legacy_id=lid
                ))
        Section.objects.bulk_create(new_rows, batch_size=BATCH)
        sections.record([(o.legacy_id, o.id, "academics_section") for o in new_rows])

        # Classes. Legacy's unique index treated NULLs as distinct, letting one
        # accidental duplicate tuple through; the new constraint is strict
        # (A1 as intended), so duplicate legacy rows merge into one class.
        new_rows, merged_pairs = [], []
        seen_tuples: dict[tuple, object] = {}
        for (lid, level, grade, faculty, year, semester, course_lid, school_lid,
             section_lid, ay_lid, name) in self._rows(
            legacy,
            "SELECT id, education_level, grade, faculty, year, semester, course_id,"
            " school_id, section_id, academic_year_id, name FROM main_classinfo ORDER BY id",
        ):
            if lid in classes or school_lid not in schools:
                continue
            row = ClassInfo(
                school_id=schools[school_lid],
                education_level=EDUCATION_LEVEL.get(level, "school"),
                grade=GRADE.get(grade, ""), faculty=FACULTY.get(faculty, ""),
                course_id=courses.get(course_lid), section_id=sections.get(section_lid),
                year=year, semester=semester, display_name=name or "",
                academic_year_id=years.get(ay_lid), legacy_id=lid,
            )
            key = (
                row.school_id, row.education_level, row.grade, row.faculty,
                row.course_id, row.section_id, row.year, row.semester,
                row.academic_year_id,
            )
            if key in seen_tuples:
                merged_pairs.append((lid, seen_tuples[key], "academics_classinfo"))
                continue
            seen_tuples[key] = row.id
            new_rows.append(row)
        ClassInfo.objects.bulk_create(new_rows, batch_size=BATCH)
        classes.record(
            [(o.legacy_id, o.id, "academics_classinfo") for o in new_rows] + merged_pairs
        )
        if merged_pairs:
            self.stdout.write(self.style.WARNING(
                f"  merged {len(merged_pairs)} duplicate legacy class tuples"
            ))

        # Subjects
        new_rows = []
        for (lid, code, name, stype, credits, school_lid, code_pr, credits_pr,
             name_pr, order, class_lid, protected) in self._rows(
            legacy,
            'SELECT id, code, subject, type, credit_hours, school_id, code_pr,'
            ' credit_hours_pr, subject_pr, "order", class_info_id, is_protected'
            " FROM main_subject ORDER BY id",
        ):
            if lid in subjects or school_lid not in schools or class_lid not in classes:
                continue
            new_rows.append(Subject(
                school_id=schools[school_lid], class_info_id=classes[class_lid],
                name=name, code=code or "", type=SUBJECT_TYPE.get(stype, "compulsory"),
                credit_hours=credits, order=order or 0, name_practical=name_pr or "",
                code_practical=code_pr or "", credit_hours_practical=credits_pr,
                is_protected=protected, legacy_id=lid,
            ))
        Subject.objects.bulk_create(new_rows, batch_size=BATCH)
        subjects.record([(o.legacy_id, o.id, "academics_subject") for o in new_rows])

        self._report("academics", len(new_rows), Subject)

    # ------------------------------------------------------------------
    # Phase 3a: staff (+ staff accounts)
    # ------------------------------------------------------------------

    def import_staff(self, legacy):
        schools = IdMap("main_schooladmin")
        subjects = IdMap("main_subject")
        staff_map = IdMap("main_staff")
        accounts = IdMap("account_staffaccount")

        roles: dict[int, object] = {}
        for role_lid, name in self._rows(legacy, "SELECT id, role FROM main_staffrole"):
            role, _ = StaffRole.objects.get_or_create(
                name=name, defaults={"legacy_id": role_lid}
            )
            roles[role_lid] = role.id

        account_rows = dict(
            (r[0], r)
            for r in self._rows(
                legacy,
                "SELECT id, username, password, verified FROM account_staffaccount",
            )
        )

        created = 0
        for (lid, status, first, middle, last, contact1, contact2, location, acc_id,
             subj1_lid, school_lid, subj2_lid, role_lid, permissions, rfid,
             birth, gender, email, qualification, joined) in self._rows(
            legacy,
            """
            SELECT s.id, s.status, s.first_name, s.middle_name, s.last_name,
                   s.primary_contact, s.secondary_contact, s.location, s.account_id,
                   s.primary_subject_id, s.school_id, s.secondary_subject_id,
                   s.role_id, s.permissions, s.rfid_card,
                   o.birth_date, o.gender, o.email, o.qualification, o.joined_date
            FROM main_staff s
            LEFT JOIN main_staffotherinfo o ON o.id = s.other_info_id
            ORDER BY s.id
            """,
        ):
            if lid in staff_map or school_lid not in schools:
                continue
            account_id = None
            if acc_id in account_rows and acc_id not in accounts:
                _, username, password, verified = account_rows[acc_id]
                account = Account(
                    username=username, role=Role.STAFF, password=password,
                    verified=verified, legacy_table="account_staffaccount", legacy_id=acc_id,
                )
                account.save()
                accounts.record([(acc_id, account.id, "identity_account")])
                account_id = account.id
            elif acc_id in accounts:
                account_id = accounts[acc_id]

            staff = Staff.objects.create(
                school_id=schools[school_lid], role_id=roles[role_lid],
                status=STAFF_STATUS.get(status, "employed"),
                first_name=first, middle_name=middle or "", last_name=last,
                gender=GENDER.get(gender, ""), birth_date_bs=birth or "",
                email=email or "", primary_contact=contact1 or "",
                secondary_contact=contact2 or "", address=location or "",
                qualification=qualification or "", joined_date_bs=joined or "",
                rfid_card=rfid or "", permissions=permissions or [],
                primary_subject_id=subjects.get(subj1_lid),
                secondary_subject_id=subjects.get(subj2_lid),
                account_id=account_id, legacy_id=lid,
            )
            staff_map.record([(lid, staff.id, "people_staff")])
            created += 1

        self._report("staff", created, Staff)

    # ------------------------------------------------------------------
    # Phase 3b: students (+ guardians + student accounts)
    # ------------------------------------------------------------------

    def import_students(self, legacy):
        years = IdMap("main_academicyear")
        classes = IdMap("main_classinfo")
        students_map = IdMap("main_student")
        accounts = IdMap("account_studentaccount")

        guardian_rows = dict(
            (r[0], r)
            for r in self._rows(
                legacy,
                "SELECT id, father_name, mother_name, guardian_name, guardian_contact,"
                " guardian_email, guardian_location, father_occupation, mother_occupation"
                " FROM main_studentguardianinfo",
            )
        )
        other_rows = dict(
            (r[0], r)
            for r in self._rows(
                legacy,
                "SELECT id, ethnicity, blood_group FROM main_studentotherinfo",
            )
        )
        account_rows = dict(
            (r[0], r)
            for r in self._rows(
                legacy,
                "SELECT id, username, password, verified FROM account_studentaccount",
            )
        )

        class_school = dict(ClassInfo.all_objects.values_list("id", "school_id"))

        rows = self._rows(legacy, """
            SELECT id, first_name, middle_name, last_name, birth_date, gender, email,
                   contact, location, status, emis, academic_year_id, class_info_id,
                   guardian_info_id, other_info_id, previous_school, remarks,
                   account_id, regd_no, roll_no, symbol_no, rfid_card
            FROM main_student ORDER BY id
        """)

        students, guardian_bundles, account_links = [], [], {}
        skipped = 0
        for (lid, first, middle, last, birth, gender, email, contact, location,
             status, emis, ay_lid, class_lid, ginfo_id, oinfo_id, prev_school,
             remarks, acc_id, regd, roll, symbol, rfid) in rows:
            if lid in students_map:
                continue
            if class_lid not in classes or ay_lid not in years:
                skipped += 1
                continue
            ethnicity, blood = "", ""
            if oinfo_id in other_rows:
                _, eth, bg = other_rows[oinfo_id]
                ethnicity, blood = ETHNICITY.get(eth or 0, ""), BLOOD_GROUP.get(bg or 0, "")

            class_id = classes[class_lid]
            school_id = class_school[class_id]

            students.append(Student(
                first_name=first, middle_name=middle or "", last_name=last,
                birth_date_bs=birth or "", gender=GENDER.get(gender, "others"),
                email=email or "", contact=contact or "", address=location or "",
                status=STUDENT_STATUS.get(status, "running"), emis=emis or "",
                academic_year_id=years[ay_lid], class_info_id=class_id,
                previous_school=prev_school or "", remarks=remarks or "",
                regd_no=regd or "", roll_no=roll or "", symbol_no=symbol or "",
                rfid_card=rfid or "", ethnicity=ethnicity, blood_group=blood,
                school_id=school_id, legacy_id=lid,
            ))
            guardian_bundles.append((lid, ginfo_id))
            if acc_id:
                account_links[lid] = acc_id

        Student.objects.bulk_create(students, batch_size=BATCH)
        students_map.record([(o.legacy_id, o.id, "people_student") for o in students])

        self._link_student_accounts(account_links, students_map, account_rows, accounts)
        self._create_guardians(guardian_bundles, guardian_rows, students_map)

        self._report("students", len(students), Student)
        if skipped:
            self.stdout.write(self.style.WARNING(
                f"  skipped {skipped} students with unmapped class/year"
            ))

    def _link_student_accounts(self, account_links, students_map, account_rows, accounts):
        for student_lid, acc_id in account_links.items():
            if acc_id not in account_rows:
                continue
            if acc_id in accounts:
                account_id = accounts[acc_id]
            else:
                _, username, password, verified = account_rows[acc_id]
                account = Account(
                    username=username, role=Role.STUDENT, password=password,
                    verified=verified, legacy_table="account_studentaccount", legacy_id=acc_id,
                )
                account.save()
                accounts.record([(acc_id, account.id, "identity_account")])
                account_id = account.id
            Student.all_objects.filter(id=students_map[student_lid]).update(
                account_id=account_id
            )

    def _create_guardians(self, bundles, guardian_rows, students_map):
        students = Student.all_objects.in_bulk(
            [students_map[lid] for lid, _ in bundles if lid in students_map]
        )
        guardians, links = [], []
        for student_lid, ginfo_id in bundles:
            row = guardian_rows.get(ginfo_id)
            student = students.get(students_map.get(student_lid))
            if not (row and student):
                continue
            (_, father, mother, guardian, g_contact, g_email, g_location,
             f_occ, m_occ) = row
            people = []
            if guardian and guardian.strip():
                people.append(("guardian", guardian.strip(), g_contact, True))
            if father and father.strip():
                primary = not people
                people.append(("father", father.strip(), g_contact if primary else "", primary))
            if mother and mother.strip():
                people.append(("mother", mother.strip(), "", False))
            occupations = {"father": OCCUPATION.get(f_occ or 0, ""),
                           "mother": OCCUPATION.get(m_occ or 0, "")}
            for relation, name, contact, is_primary in people:
                g = Guardian(
                    school_id=student.school_id, name=name, contact=contact or "",
                    email=(g_email or "") if is_primary else "",
                    address=g_location or "", occupation=occupations.get(relation, ""),
                )
                guardians.append(g)
                links.append((g, student.id, relation, is_primary))

        Guardian.objects.bulk_create(guardians, batch_size=BATCH)
        StudentGuardian.objects.bulk_create(
            [
                StudentGuardian(
                    student_id=student_id, guardian_id=g.id,
                    relation=relation, is_primary_contact=is_primary,
                )
                for g, student_id, relation, is_primary in links
            ],
            batch_size=BATCH,
        )

    # ------------------------------------------------------------------
    # Phase 4a: examinations (exams, schedules, grading, sheets, extras)
    # ------------------------------------------------------------------

    def import_examinations(self, legacy):
        schools = IdMap("main_schooladmin")
        years = IdMap("main_academicyear")
        classes = IdMap("main_classinfo")
        subjects = IdMap("main_subject")
        students = IdMap("main_student")
        exams = IdMap("main_exam")
        sheets = IdMap("main_classresult")

        def dec(value):
            return None if value in (None, "") else value

        # Exams
        new_rows = []
        for lid, name, inclusion, ay_lid, school_lid, attd in self._rows(
            legacy,
            "SELECT id, name, inclusion, academic_year_id, school_id,"
            " attendance_inclusion FROM main_exam ORDER BY id",
        ):
            if lid in exams or school_lid not in schools or ay_lid not in years:
                continue
            new_rows.append(Exam(
                school_id=schools[school_lid], academic_year_id=years[ay_lid],
                name=name, inclusion_weight=inclusion, include_attendance=attd,
                legacy_id=lid,
            ))
        Exam.objects.bulk_create(new_rows, batch_size=BATCH)
        exams.record([(o.legacy_id, o.id, "examinations_exam") for o in new_rows])
        self._report("exams", len(new_rows), Exam)

        # Schedule entries: explode {subject_lid: date_bs}; last wins per sitting
        if not ExamScheduleEntry.all_objects.exists():
            sittings = {}
            for exam_lid, class_lid, start, end, schedule in self._rows(
                legacy,
                "SELECT exam_id, class_info_id, start_time, end_time, schedule"
                " FROM main_examschedule ORDER BY id",
            ):
                if exam_lid not in exams or class_lid not in classes:
                    continue
                for subject_lid, date_bs in (schedule or {}).items():
                    subject_id = subjects.get(int(subject_lid))
                    if subject_id:
                        key = (exams[exam_lid], classes[class_lid], subject_id)
                        sittings[key] = (str(date_bs)[:10], start or "", end or "")
            exam_school = dict(Exam.all_objects.values_list("id", "school_id"))
            ExamScheduleEntry.objects.bulk_create(
                [
                    ExamScheduleEntry(
                        school_id=exam_school[exam_id], exam_id=exam_id,
                        class_info_id=class_id, subject_id=subject_id,
                        exam_date_bs=date_bs, start_time=start, end_time=end,
                    )
                    for (exam_id, class_id, subject_id), (date_bs, start, end)
                    in sittings.items()
                ],
                batch_size=BATCH,
            )
            self._report("schedule", len(sittings), ExamScheduleEntry)

        # Grading schemes: dedupe (school, type), latest id wins
        if not GradingScheme.all_objects.exists():
            type_map = {1: "number", 2: "grading", 4: "division"}
            latest = {}
            for _lid, rtype, rules, school_lid in self._rows(
                legacy,
                "SELECT id, type, rules, school_id FROM main_gradingrules"
                " WHERE is_active ORDER BY id",
            ):
                if school_lid in schools and rtype in type_map:
                    latest[(schools[school_lid], type_map[rtype])] = rules or []
            for (school_id, rtype), rules in latest.items():
                scheme = GradingScheme.objects.create(school_id=school_id, type=rtype)
                GradeBand.objects.bulk_create([
                    GradeBand(
                        scheme=scheme, school_id=school_id,
                        min_score=band.get("min") or 0, max_score=band.get("max") or 0,
                        remarks=str(band.get("remarks") or "")[:60],
                    )
                    for band in rules
                    if isinstance(band, dict)
                ])
            self._report("grading schemes", len(latest), GradingScheme)

        # Result sheets: dedupe (exam, class, subject) with latest-id-wins;
        # every legacy id (winners AND superseded duplicates) maps to the one
        # surviving sheet so student results can be remapped onto it.
        exam_school = dict(Exam.all_objects.values_list("id", "school_id"))
        latest_sheet: dict[tuple, tuple] = {}
        lids_by_key: dict[tuple, list[int]] = {}
        for lid, criteria, published, class_lid, subject_lid, exam_lid in self._rows(
            legacy,
            "SELECT id, criteria, published_date, class_info_id, subject_id, exam_id"
            " FROM main_classresult ORDER BY id",
        ):
            if lid in sheets:
                continue
            if (
                exam_lid not in exams
                or class_lid not in classes
                or subject_lid not in subjects
            ):
                continue
            key = (exams[exam_lid], classes[class_lid], subjects[subject_lid])
            latest_sheet[key] = (lid, criteria, published)
            lids_by_key.setdefault(key, []).append(lid)

        sheet_rows = []
        for (exam_id, class_id, subject_id), (lid, criteria, published) in latest_sheet.items():
            criteria = criteria or {}
            attendance = criteria.get("attendance")
            try:
                attendance = int(attendance) if attendance not in (None, "") else None
            except (TypeError, ValueError):
                attendance = None
            sheet_rows.append(SubjectResultSheet(
                school_id=exam_school[exam_id],
                exam_id=exam_id, class_info_id=class_id, subject_id=subject_id,
                full_marks=dec(criteria.get("fm")) or 0,
                pass_marks=dec(criteria.get("pm")) or 0,
                full_marks_theory=dec(criteria.get("fm_th")),
                pass_marks_theory=dec(criteria.get("pm_th")),
                full_marks_practical=dec(criteria.get("fm_pr")),
                pass_marks_practical=dec(criteria.get("pm_pr")),
                attendance_days=attendance,
                published_date_bs=(published or "")[:10],
                legacy_id=lid,
            ))
        SubjectResultSheet.objects.bulk_create(sheet_rows, batch_size=BATCH)
        by_key = {(o.exam_id, o.class_info_id, o.subject_id): o.id for o in sheet_rows}
        map_pairs, merged = [], 0
        for key, lids in lids_by_key.items():
            for lid in lids:
                map_pairs.append((lid, by_key[key], "examinations_subjectresultsheet"))
            merged += len(lids) - 1
        sheets.record(map_pairs)
        self._report("result sheets", len(sheet_rows), SubjectResultSheet)
        if merged:
            self.stdout.write(self.style.WARNING(
                f"  merged {merged} duplicate legacy sheets"
            ))

        # Extra activities + entries, certificates
        if not ActivityDefinition.all_objects.exists():
            activity_map = {}
            for lid, name, school_lid in self._rows(
                legacy, "SELECT id, name, school_id FROM main_extraactivity ORDER BY id"
            ):
                if school_lid in schools:
                    row = ActivityDefinition.objects.create(
                        school_id=schools[school_lid], name=name, legacy_id=lid
                    )
                    activity_map[lid] = row.id
            latest_entries = {}
            for exam_lid, class_lid, student_lid, entries, school_lid in self._rows(
                legacy,
                "SELECT exam_id, class_info_id, student_id, extra_activities, school_id"
                " FROM main_extraactivityentry ORDER BY id",
            ):
                if (
                    exam_lid in exams and class_lid in classes
                    and student_lid in students and school_lid in schools
                ):
                    latest_entries[(exams[exam_lid], students[student_lid])] = (
                        classes[class_lid], schools[school_lid], entries or {}
                    )
            grade_rows = []
            for (exam_id, student_id), (class_id, school_id, entries) in latest_entries.items():
                for activity_lid, grade in entries.items():
                    activity_id = activity_map.get(int(activity_lid))
                    if activity_id:
                        grade_rows.append(ActivityGrade(
                            school_id=school_id, exam_id=exam_id, class_info_id=class_id,
                            student_id=student_id, activity_id=activity_id,
                            grade=str(grade)[:20],
                        ))
            ActivityGrade.objects.bulk_create(grade_rows, batch_size=BATCH)
            self._report("activity grades", len(grade_rows), ActivityGrade)

        certs = IdMap("main_charactercertificate")
        cert_rows = []
        for lid, data, school_lid, student_lid, serial in self._rows(
            legacy,
            "SELECT id, data, school_id, student_id, serial_no"
            " FROM main_charactercertificate ORDER BY id",
        ):
            if lid in certs or school_lid not in schools:
                continue
            cert_rows.append(CharacterCertificate(
                school_id=schools[school_lid], student_id=students.get(student_lid),
                serial_no=str(serial)[:40], data=data or {}, legacy_id=lid,
            ))
        CharacterCertificate.objects.bulk_create(cert_rows, batch_size=BATCH)
        certs.record(
            [(o.legacy_id, o.id, "examinations_charactercertificate") for o in cert_rows]
        )
        self._report("certificates", len(cert_rows), CharacterCertificate)

    # ------------------------------------------------------------------
    # Phase 4b: student results (2.47M rows; dedupe latest-entry-wins)
    # ------------------------------------------------------------------

    def import_student_results(self, legacy):
        """
        Legacy re-created result rows on every save (446k duplicate
        (sheet, student) pairs in production). DISTINCT ON in the legacy DB
        keeps only the latest row per legacy pair; pairs that can still
        collide because duplicate sheets were merged (the alias sheets) are
        buffered and arbitrated in Python by highest legacy id.
        """
        sheets = IdMap("main_classresult")
        students = IdMap("main_student")
        sheet_school = dict(SubjectResultSheet.all_objects.values_list("id", "school_id"))
        done_sheets = set(
            StudentSubjectResult.all_objects.values_list("sheet_id", flat=True).distinct()
        )

        # New sheet ids fed by more than one legacy sheet (cross-group collisions)
        alias_counts: dict = {}
        for new_id in sheets.map.values():
            alias_counts[new_id] = alias_counts.get(new_id, 0) + 1
        alias_sheets = {new_id for new_id, n in alias_counts.items() if n > 1}

        total_created = skipped = 0
        batch: list[StudentSubjectResult] = []
        buffered: dict[tuple, StudentSubjectResult] = {}

        def make_row(sheet_id, student_id, values) -> StudentSubjectResult:
            (lid, theory, practical, total, inclusion, passed, absent,
             attendance, pos_class, pos_section) = values
            return StudentSubjectResult(
                school_id=sheet_school[sheet_id], sheet_id=sheet_id,
                student_id=student_id, theory=theory, practical=practical,
                total=total or 0, inclusion=inclusion, attendance_days=attendance,
                passed=passed, absent=bool(absent),
                position_in_section=pos_section, position_in_class=pos_class,
                legacy_id=lid,
            )

        with legacy.cursor(name="studentresults") as cur:  # server-side cursor
            cur.itersize = 20000
            cur.execute(
                "SELECT DISTINCT ON (class_result_id, student_id)"
                " id, theory, practical, total, inclusion, result, absent,"
                " attendance, position_in_class, position_in_section,"
                " class_result_id, student_id"
                " FROM main_studentresult"
                " ORDER BY class_result_id, student_id, id DESC"
            )
            for row in cur:
                values, sheet_lid, student_lid = row[:10], row[10], row[11]
                sheet_id = sheets.get(sheet_lid)
                student_id = students.get(student_lid)
                if not (sheet_id and student_id) or sheet_id in done_sheets:
                    skipped += 1
                    continue
                if sheet_id in alias_sheets:
                    key = (sheet_id, student_id)
                    current = buffered.get(key)
                    if current is None or values[0] > current.legacy_id:
                        buffered[key] = make_row(sheet_id, student_id, values)
                    continue
                batch.append(make_row(sheet_id, student_id, values))
                if len(batch) >= BATCH:
                    StudentSubjectResult.objects.bulk_create(batch)
                    total_created += len(batch)
                    batch = []

        batch.extend(buffered.values())
        StudentSubjectResult.objects.bulk_create(batch, batch_size=BATCH)
        total_created += len(batch)

        self._report("student results", total_created, StudentSubjectResult)
        if skipped:
            self.stdout.write(self.style.WARNING(f"  skipped {skipped} unmapped rows"))

    # ------------------------------------------------------------------
    # Phase 5: attendance (443 duplicate legacy sessions merge, latest wins)
    # ------------------------------------------------------------------

    def import_attendance(self, legacy):
        from apps.attendance.models import (
            ClassAttendanceSession,
            StaffAttendanceRecord,
            StudentAttendanceRecord,
        )

        schools = IdMap("main_schooladmin")
        classes = IdMap("main_classinfo")
        students = IdMap("main_student")
        staff = IdMap("main_staff")
        sessions = IdMap("main_classattendance")

        # Class sessions: dedupe (school, class, date), latest id wins.
        latest, lids_by_key = {}, {}
        for lid, date_bs, class_lid, school_lid, teacher_lid in self._rows(
            legacy,
            "SELECT id, date, class_info_id, school_id, teacher_id"
            " FROM main_classattendance WHERE is_active ORDER BY id",
        ):
            if lid in sessions or school_lid not in schools or class_lid not in classes:
                continue
            key = (schools[school_lid], classes[class_lid], date_bs)
            latest[key] = (lid, teacher_lid)
            lids_by_key.setdefault(key, []).append(lid)

        rows = [
            ClassAttendanceSession(
                school_id=school_id, class_info_id=class_id, date_bs=date_bs,
                teacher_id=staff.get(teacher_lid), legacy_id=lid,
            )
            for (school_id, class_id, date_bs), (lid, teacher_lid) in latest.items()
        ]
        ClassAttendanceSession.objects.bulk_create(rows, batch_size=BATCH)
        by_key = {(o.school_id, o.class_info_id, o.date_bs): o.id for o in rows}
        sessions.record([
            (lid, by_key[key], "attendance_classattendancesession")
            for key, lids in lids_by_key.items()
            for lid in lids
        ])
        merged = sum(len(lids) - 1 for lids in lids_by_key.values())
        self._report("class sessions", len(rows), ClassAttendanceSession)
        if merged:
            self.stdout.write(self.style.WARNING(f"  merged {merged} duplicate sessions"))

        # Student records: unique (session, student); collisions only via
        # merged sessions — arbitrated by highest legacy id.
        if not StudentAttendanceRecord.all_objects.exists():
            best: dict[tuple, tuple] = {}
            with legacy.cursor(name="studentattd") as cur:
                cur.itersize = 20000
                cur.execute(
                    "SELECT id, status, reason, class_attendance_id, student_id,"
                    " checked_in_at, checked_out_at FROM main_studentattendance"
                    " WHERE is_active ORDER BY id"
                )
                for lid, present, reason, session_lid, student_lid, cin, cout in cur:
                    session_id = sessions.get(session_lid)
                    student_id = students.get(student_lid)
                    if not (session_id and student_id):
                        continue
                    best[(session_id, student_id)] = (lid, present, reason or "", cin, cout)
            StudentAttendanceRecord.objects.bulk_create(
                [
                    StudentAttendanceRecord(
                        session_id=session_id, student_id=student_id, present=present,
                        reason=reason, checked_in_at=cin, checked_out_at=cout,
                    )
                    for (session_id, student_id), (lid, present, reason, cin, cout)
                    in best.items()
                ],
                batch_size=BATCH,
            )
            self._report("student records", len(best), StudentAttendanceRecord)

        # Staff records: unique (staff, date) — clean in legacy, but keep
        # latest-wins for safety.
        if not StaffAttendanceRecord.all_objects.exists():
            best = {}
            for lid, date_bs, present, reason, school_lid, staff_lid, cin, cout in self._rows(
                legacy,
                "SELECT id, date, status, reason, school_id, staff_id,"
                " checked_in_at, checked_out_at FROM main_staffattendance"
                " WHERE is_active ORDER BY id",
            ):
                staff_id = staff.get(staff_lid)
                if staff_id and school_lid in schools:
                    best[(staff_id, date_bs)] = (
                        lid, schools[school_lid], present, reason or "", cin, cout
                    )
            StaffAttendanceRecord.objects.bulk_create(
                [
                    StaffAttendanceRecord(
                        staff_id=staff_id, date_bs=date_bs, school_id=school_id,
                        present=present, reason=reason,
                        checked_in_at=cin, checked_out_at=cout, legacy_id=lid,
                    )
                    for (staff_id, date_bs), (lid, school_id, present, reason, cin, cout)
                    in best.items()
                ],
                batch_size=BATCH,
            )
            self._report("staff records", len(best), StaffAttendanceRecord)

    # ------------------------------------------------------------------
    # Phase 6: RFID devices, device users, punch logs
    # ------------------------------------------------------------------

    def import_devices(self, legacy):
        from apps.devices.models import Device, DeviceUser, PunchLog

        schools = IdMap("main_schooladmin")
        students = IdMap("main_student")
        staff = IdMap("main_staff")
        devices = IdMap("rfid_device")
        device_users = IdMap("rfid_rfidattduser")

        for (lid, serial, alias, ip, firmware, pushver, dtype, key, tz_min,
             realtime, last_seen, a_stamp, o_stamp, p_stamp, users, fps, faces,
             trans, school_lid) in self._rows(
            legacy,
            "SELECT id, serial_number, alias, ip_address, firmware, push_version,"
            " device_type, push_comm_key, timezone_min, real_time, last_seen,"
            " attlog_stamp, operlog_stamp, photo_stamp, user_count, fp_count,"
            " face_count, trans_count, school_id FROM rfid_device ORDER BY id",
        ):
            if lid in devices or school_lid not in schools:
                continue
            device = Device.objects.create(
                school_id=schools[school_lid], serial_number=serial,
                alias=alias or "", ip_address=str(ip) if ip else None,
                firmware=firmware or "", push_version=pushver or "",
                device_type=dtype or "", push_comm_key=key or "",
                timezone_min=tz_min, real_time=realtime, last_seen=last_seen,
                attlog_stamp=a_stamp or "None", operlog_stamp=o_stamp or "None",
                photo_stamp=p_stamp or "None", user_count=users, fp_count=fps,
                face_count=faces, trans_count=trans,
                state=Device.State.REGISTERED, legacy_id=lid,
            )
            devices.record([(lid, device.id, "devices_device")])
        self._report("devices", len(devices.map), Device)

        device_school = dict(Device.all_objects.values_list("id", "school_id"))
        new_rows = []
        for (lid, active, pin, privilege, password, card, group_id, tz_str,
             verify, device_lid, staff_lid, student_lid) in self._rows(
            legacy,
            "SELECT id, is_active, pin, privilege, password, card, group_id,"
            " tz_str, verify, device_id, staff_id, student_id"
            " FROM rfid_rfidattduser ORDER BY id",
        ):
            device_id = devices.get(device_lid)
            if lid in device_users or not device_id:
                continue
            new_rows.append(DeviceUser(
                school_id=device_school[device_id], device_id=device_id,
                pin=pin, privilege=privilege, password=password or "",
                card=card or "", group_id=group_id, tz_str=tz_str or "",
                verify=verify, student_id=students.get(student_lid),
                staff_id=staff.get(staff_lid), is_active=active, legacy_id=lid,
            ))
        DeviceUser.objects.bulk_create(new_rows, batch_size=BATCH)
        device_users.record([(o.legacy_id, o.id, "devices_deviceuser") for o in new_rows])
        self._report("device users", len(new_rows), DeviceUser)

        if not PunchLog.objects.exists():
            punch_rows = []
            for lid, punch_time, status, verify, workcode, received, user_lid in self._rows(
                legacy,
                "SELECT id, punch_time, status, verify, workcode, received_at,"
                " user_id FROM rfid_rfidattdlogs ORDER BY id",
            ):
                punch_rows.append(PunchLog(
                    user_id=device_users.get(user_lid), punch_time=punch_time,
                    status=status, verify=verify, workcode=workcode,
                    legacy_id=lid,
                ))
            PunchLog.objects.bulk_create(punch_rows, batch_size=BATCH)
            self._report("punch logs", len(punch_rows), PunchLog)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _rows(legacy, sql: str):
        with legacy.cursor() as cur:
            cur.execute(sql)
            yield from cur

    @staticmethod
    def _unique_slug(name: str, legacy_id: int) -> str:
        base = slugify(name)[:50] or "school"
        if School.all_objects.filter(slug=base).exists():
            return f"{base}-{legacy_id}"
        return base

    def _report(self, phase: str, created: int, model):
        manager = getattr(model, "all_objects", model.objects)
        self.stdout.write(
            self.style.SUCCESS(f"[{phase}] created {created}; total {manager.count()}")
        )
