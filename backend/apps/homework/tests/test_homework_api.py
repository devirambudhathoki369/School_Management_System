"""Homework: author defaulting, attachments, homework-gated staff lookup."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.academics.models import ClassInfo, Subject
from apps.homework.models import Homework
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


def setup_class_subject(school):
    student = make_student(school, "Hw")
    class_info = ClassInfo.objects.get(school=school)
    subject = Subject.objects.create(
        school=school, class_info=class_info, name="Science", credit_hours="4.00"
    )
    return student, class_info, subject


@pytest.mark.django_db
class TestHomeworkApi:
    def test_teacher_is_default_author(self, db):
        school = make_school("hw1")
        _, class_info, subject = setup_class_subject(school)
        teacher = make_staff(school, "hw1_teacher", ["homework.manage"])
        api = APIClient()
        login(api, "hw1_teacher", "staff")
        res = api.post(
            "/api/v1/homework/assignments/",
            {
                "title": "Read chapter 2", "due_date_bs": "2082-04-01",
                "class_info": str(class_info.id), "subject": str(subject.id),
            },
        )
        assert res.status_code == 201, res.content
        assert Homework.objects.get(id=res.data["id"]).staff_id == teacher.id

    def test_admin_must_name_the_teacher(self, db):
        school = make_school("hw2")
        _, class_info, subject = setup_class_subject(school)
        api = APIClient()
        login(api, "admin_hw2", "admin")
        res = api.post(
            "/api/v1/homework/assignments/",
            {
                "title": "Essay", "due_date_bs": "2082-04-01",
                "class_info": str(class_info.id), "subject": str(subject.id),
            },
        )
        assert res.status_code == 400
        assert "staff" in res.data["error"]["details"]

    def test_attachment_upload_and_remove(self, db, settings, tmp_path):
        settings.MEDIA_ROOT = tmp_path
        school = make_school("hw3")
        _, class_info, subject = setup_class_subject(school)
        make_staff(school, "hw3_teacher", ["homework.manage"])
        api = APIClient()
        login(api, "hw3_teacher", "staff")
        hw = api.post(
            "/api/v1/homework/assignments/",
            {
                "title": "Worksheet", "due_date_bs": "2082-04-02",
                "class_info": str(class_info.id), "subject": str(subject.id),
            },
        ).data
        up = api.post(
            f"/api/v1/homework/assignments/{hw['id']}/attachments/",
            {"file": SimpleUploadedFile("sheet.pdf", b"%PDF-1.4", "application/pdf")},
            format="multipart",
        )
        assert up.status_code == 201, up.content
        detail = api.get(f"/api/v1/homework/assignments/{hw['id']}/")
        assert len(detail.data["attachments"]) == 1
        rm = api.delete(
            f"/api/v1/homework/assignments/{hw['id']}/attachments/{up.data['id']}/"
        )
        assert rm.status_code == 204
        detail = api.get(f"/api/v1/homework/assignments/{hw['id']}/")
        assert detail.data["attachments"] == []

    def test_staff_lookup_under_homework_grant(self, db):
        school = make_school("hw4")
        make_staff(school, "hw4_clerk", ["homework.view"])
        api = APIClient()
        login(api, "hw4_clerk", "staff")
        res = api.get("/api/v1/homework/staff-lookup/")
        assert res.status_code == 200
        assert [r["full_name"] for r in res.data["results"]] == ["Hari Karki"]
        assert api.get("/api/v1/people/staff/").status_code == 403
