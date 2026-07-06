"""Sheet roster: class list for marks entry under the examinations grant."""

import pytest
from rest_framework.test import APIClient

from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login

from .test_examinations import exam_setup  # noqa: F401 — fixture


@pytest.mark.django_db
class TestSheetRoster:
    def test_exam_clerk_gets_names_without_students_grant(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        make_staff(school, "marks_clerk", ["examinations.manage"])
        api = APIClient()
        login(api, "marks_clerk", "staff")
        res = api.get(f"/api/v1/examinations/sheets/{sheet.id}/roster/")
        assert res.status_code == 200
        assert [row["full_name"] for row in res.data] == [
            "Amina Delta", "Binita Delta", "Champa Delta",
        ]
        assert set(res.data[0]) == {"id", "full_name", "roll_no"}
        # the students module itself stays closed
        assert api.get("/api/v1/people/students/").status_code == 403

    def test_marks_rows_carry_names(self, exam_setup):  # noqa: F811
        school, exam, class_a, class_b, sheet, students = exam_setup
        api = APIClient()
        login(api, "admin_delta", "admin")
        res = api.put(
            f"/api/v1/examinations/sheets/{sheet.id}/marks/entry/",
            {"marks": [{"student": str(students[0].id), "theory": "50", "practical": "20"}]},
            format="json",
        )
        assert res.status_code == 200, res.content
        rows = api.get(f"/api/v1/examinations/sheets/{sheet.id}/marks/").data
        assert rows[0]["student_name"] == "Amina Delta"
