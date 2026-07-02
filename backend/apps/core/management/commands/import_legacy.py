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
            "--phase", choices=["all", "tenants", "academics", "people"], default="all"
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
            SchoolSettings.objects.create(
                school=school, uses_sms=uses_sms, uses_mobile_app=uses_app,
                time_set_required=time_set, attendance_in_time=in_time,
                attendance_out_time=out_time,
                hidden_education_levels=[x for x in hidden_levels.get(lid, []) if x],
            )
            SchoolBranding.objects.create(
                school=school, slogan=slogan or "", about_us=about_us or ""
            )
            schools.record([(lid, school.id, "tenants_school")])
            created += 1

        for lid, name, contact, school_lid in self._rows(
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
        total = model.all_objects.count()
        self.stdout.write(
            self.style.SUCCESS(f"[{phase}] created {created}; total {total}")
        )
