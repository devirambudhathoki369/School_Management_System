"""Bulk enrolment: one class, many rows, all-or-nothing."""

import pytest
from rest_framework.test import APIClient

from apps.people.models import Student
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


@pytest.mark.django_db
class TestBulkEnroll:
    def test_enrolls_rows_into_class(self, db):
        school = make_school("bulk")
        anchor = make_student(school, "Anchor")  # creates year + class
        api = APIClient()
        login(api, "admin_bulk", "admin")
        res = api.post("/api/v1/people/students/bulk-enroll/", {
            "class_info": str(anchor.class_info_id),
            "rows": [
                {"first_name": "Ram", "last_name": "KC", "gender": "male", "roll_no": "1"},
                {"first_name": "Sita", "last_name": "Sharma", "gender": "female"},
            ],
        }, format="json")
        assert res.status_code == 201, res.content
        assert res.data["enrolled"] == 2
        assert Student.objects.filter(school=school).count() == 3
        sita = Student.objects.get(first_name="Sita")
        assert sita.class_info_id == anchor.class_info_id
        assert sita.academic_year_id == anchor.academic_year_id

    def test_bad_row_rejects_whole_batch(self, db):
        school = make_school("bulk2")
        anchor = make_student(school, "Anchor")
        api = APIClient()
        login(api, "admin_bulk2", "admin")
        res = api.post("/api/v1/people/students/bulk-enroll/", {
            "class_info": str(anchor.class_info_id),
            "rows": [
                {"first_name": "Ok", "last_name": "Row", "gender": "male"},
                {"first_name": "", "last_name": "Nameless", "gender": "male"},
            ],
        }, format="json")
        assert res.status_code == 400
        assert "Row 2" in str(res.data)
        assert Student.objects.filter(school=school).count() == 1  # nothing landed

    def test_foreign_class_refused(self, db):
        make_school("bulka")
        school_b = make_school("bulkb")
        other = make_student(school_b, "Other")
        api = APIClient()
        login(api, "admin_bulka", "admin")
        res = api.post("/api/v1/people/students/bulk-enroll/", {
            "class_info": str(other.class_info_id),
            "rows": [{"first_name": "X", "last_name": "Y", "gender": "male"}],
        }, format="json")
        assert res.status_code == 400
