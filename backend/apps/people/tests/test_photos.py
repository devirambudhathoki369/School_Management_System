"""Validated file intake: photos, spoofed types, size caps, tenancy."""

import io

import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.people.models import Student
from apps.people.tests.test_module_permissions import make_staff
from apps.people.tests.test_tenant_isolation import login, make_school, make_student


def png_bytes(size=(80, 80)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format="PNG")
    return buffer.getvalue()


def upload(api, student_id, content: bytes, filename="photo.png"):
    return api.post(
        f"/api/v1/people/students/{student_id}/photo/",
        {"photo": io.BytesIO(content)},
        format="multipart",
        **{"photo": (filename, content)},
    )


@pytest.mark.django_db
class TestStudentPhoto:
    def test_upload_replace_and_remove(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        school = make_school("photoy")
        student = make_student(school, "Pema")
        api = APIClient()
        login(api, "admin_photoy", "admin")

        from django.core.files.uploadedfile import SimpleUploadedFile

        res = api.post(
            f"/api/v1/people/students/{student.id}/photo/",
            {"photo": SimpleUploadedFile("me.png", png_bytes(), "image/png")},
            format="multipart",
        )
        assert res.status_code == 200, res.content
        student.refresh_from_db()
        # stored under the school prefix with a fresh name — the client's
        # filename never reaches the filesystem
        assert student.photo.name.startswith(f"schools/{school.id}/student-photos/")
        assert "me" not in student.photo.name
        first_name = student.photo.name

        # replacing deletes the old file
        api.post(
            f"/api/v1/people/students/{student.id}/photo/",
            {"photo": SimpleUploadedFile("new.png", png_bytes((60, 60)), "image/png")},
            format="multipart",
        )
        student.refresh_from_db()
        assert student.photo.name != first_name
        assert not (tmp_path / first_name).exists()

        assert api.delete(f"/api/v1/people/students/{student.id}/photo/").status_code == 204
        student.refresh_from_db()
        assert not student.photo

    def test_spoofed_extension_is_rejected(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        school = make_school("spoofy")
        student = make_student(school, "Gita")
        api = APIClient()
        login(api, "admin_spoofy", "admin")
        from django.core.files.uploadedfile import SimpleUploadedFile

        # an executable dressed as an image: content decides, so it bounces
        res = api.post(
            f"/api/v1/people/students/{student.id}/photo/",
            {"photo": SimpleUploadedFile("evil.png", b"MZ\x90\x00" + b"A" * 64, "image/png")},
            format="multipart",
        )
        assert res.status_code == 400
        student.refresh_from_db()
        assert not student.photo

    def test_size_cap(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        school = make_school("bigy")
        student = make_student(school, "Hema")
        api = APIClient()
        login(api, "admin_bigy", "admin")
        from django.core.files.uploadedfile import SimpleUploadedFile

        blob = png_bytes() + b"\x00" * (6 * 1024 * 1024)  # valid header, >5MB
        res = api.post(
            f"/api/v1/people/students/{student.id}/photo/",
            {"photo": SimpleUploadedFile("huge.png", blob, "image/png")},
            format="multipart",
        )
        assert res.status_code == 400
        assert "limit" in str(res.data)

    def test_other_schools_students_are_unreachable(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        school_a = make_school("phalpha")
        make_school("phbeta")
        student = make_student(school_a, "Nira")
        api = APIClient()
        login(api, "admin_phbeta", "admin")
        from django.core.files.uploadedfile import SimpleUploadedFile

        res = api.post(
            f"/api/v1/people/students/{student.id}/photo/",
            {"photo": SimpleUploadedFile("x.png", png_bytes(), "image/png")},
            format="multipart",
        )
        assert res.status_code == 404  # invisible across the tenant boundary

    def test_direct_field_write_is_ignored(self, tmp_path, settings):
        """PATCHing the student record cannot smuggle a photo past intake."""
        settings.MEDIA_ROOT = tmp_path
        school = make_school("smuggly")
        student = make_student(school, "Rita")
        api = APIClient()
        login(api, "admin_smuggly", "admin")
        res = api.patch(
            f"/api/v1/people/students/{student.id}/",
            {"photo": "schools/whatever/evil.png", "remarks": "ok"},
            format="json",
        )
        assert res.status_code == 200
        assert Student.objects.get(id=student.id).photo.name == ""


@pytest.mark.django_db
class TestHomeworkIntake:
    def test_attachment_extension_comes_from_content(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        from apps.academics.models import AcademicYear, ClassInfo

        school = make_school("hwup")
        make_staff(school, "hw_teacher", ["homework.manage"])
        year = AcademicYear.objects.get_or_create(
            school=school, name="2082",
            defaults={"start_date_bs": "2082-01-01", "end_date_bs": "2082-12-30"},
        )[0]
        class_info = ClassInfo.objects.get_or_create(
            school=school, education_level="school", grade="one", academic_year=year
        )[0]
        api = APIClient()
        login(api, "hw_teacher", "staff")
        from apps.academics.models import Subject

        subject = Subject.objects.create(
            school=school, class_info=class_info, name="Maths", credit_hours="4.00"
        )
        res = api.post(
            "/api/v1/homework/assignments/",
            {
                "class_info": str(class_info.id),
                "subject": str(subject.id),
                "title": "Fractions",
                "description": "p. 40",
                "assigned_date_bs": "2082-01-10",
                "due_date_bs": "2082-01-15",
            },
            format="json",
        )
        assert res.status_code == 201, res.content
        homework_id = res.data["id"]

        from django.core.files.uploadedfile import SimpleUploadedFile

        # a PDF pretending to be .docx stores as .pdf (content wins)
        res = api.post(
            f"/api/v1/homework/assignments/{homework_id}/attachments/",
            {"file": SimpleUploadedFile("sheet.docx", b"%PDF-1.7 fake body", "application/pdf")},
            format="multipart",
        )
        assert res.status_code == 201, res.content
        assert res.data["file"].endswith(".pdf")
        assert f"schools/{school.id}/homework/" in res.data["file"]

        # random binary is refused outright
        res = api.post(
            f"/api/v1/homework/assignments/{homework_id}/attachments/",
            {"file": SimpleUploadedFile("virus.pdf", b"\x00\x01\x02\x03" * 40, "application/pdf")},
            format="multipart",
        )
        assert res.status_code == 400
