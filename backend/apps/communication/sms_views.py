"""
Outbound SMS endpoints — the legacy "SMS and Communication" send leaves.

All sends go through the provider abstraction (settings.SMS_PROVIDER;
console provider logs until a gateway is configured) and leave one
DeliveryLog row per number, so the register shows what left the building
regardless of provider.

- POST send/           free-form message to a class's guardians, all staff,
                       or explicit numbers
- POST dues-reminder/  templated per-student dues message to guardians of
                       everyone owing above a threshold
"""

from decimal import Decimal

from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.models import ClassInfo
from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.identity.models import Role
from apps.people.models import Staff, Student
from apps.tenants.services import resolve_school_for

from .models import DeliveryLog
from .providers import send_sms

MANAGERS = (Role.ADMIN, Role.STAFF)


class BaseSMSView(APIView):
    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles = MANAGERS
    permission_code = "communication"

    def school(self, request):
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        return school

    def log_and_send(self, school, title, pairs) -> int:
        """pairs = [(number, message)] — one DeliveryLog row per number."""
        sent = 0
        for number, message in pairs:
            sent += send_sms([number], message)
            DeliveryLog.objects.create(
                school=school, title=title, body=message[:500],
                data={"number": number, "channel": "sms"},
                status=DeliveryLog.Status.SENT,
            )
        return sent


def guardian_numbers(students):
    """Unique guardian (fallback: student) contact per student."""
    pairs = []
    seen = set()
    for student in students:
        number = ""
        for link in student.guardian_links.all():
            if link.guardian.contact:
                number = link.guardian.contact
                break
        number = number or student.contact
        if number and number not in seen:
            seen.add(number)
            pairs.append((student, number))
    return pairs


class SendSMSView(BaseSMSView):
    """Free-form send: {message, class_info? | staff? | numbers?}."""

    def post(self, request):
        school = self.school(request)
        message = (request.data.get("message") or "").strip()
        if not message:
            raise ValidationError({"message": "Write the message."})
        numbers: list[str] = []
        if request.data.get("class_info"):
            class_info = ClassInfo.objects.filter(
                school=school, id=request.data["class_info"]
            ).first()
            if class_info is None:
                raise ValidationError({"class_info": "Unknown class."})
            students = Student.objects.filter(
                school=school, class_info=class_info, status=Student.Status.RUNNING
            ).prefetch_related("guardian_links__guardian")
            numbers = [n for _, n in guardian_numbers(students)]
        elif request.data.get("staff"):
            numbers = list(
                Staff.objects.filter(school=school)
                .exclude(contact="")
                .values_list("contact", flat=True)
            )
        elif isinstance(request.data.get("numbers"), list):
            numbers = [str(n).strip() for n in request.data["numbers"] if str(n).strip()]
        if not numbers:
            raise ValidationError({"numbers": "Nobody to send to."})
        sent = self.log_and_send(school, "Bulk SMS", [(n, message) for n in numbers])
        return Response({"sent": sent})


class DuesReminderSMSView(BaseSMSView):
    """Templated dues reminders: {class_info?, min_dues?, template?}.
    `{name}` and `{dues}` interpolate per student; dues are the student's
    full outstanding balance (M1-consistent, same figure the desk sees)."""

    DEFAULT_TEMPLATE = (
        "Dear guardian, {name}'s outstanding dues are Rs. {dues}. "
        "Please clear them at the earliest. Thank you."
    )

    def post(self, request):
        from apps.billing.services.dues import student_dues

        school = self.school(request)
        try:
            min_dues = Decimal(str(request.data.get("min_dues") or "1"))
        except ArithmeticError:
            raise ValidationError({"min_dues": "Enter a number."})
        template = (request.data.get("template") or self.DEFAULT_TEMPLATE).strip()
        students = Student.objects.filter(
            school=school, status=Student.Status.RUNNING
        ).prefetch_related("guardian_links__guardian")
        if request.data.get("class_info"):
            students = students.filter(class_info=request.data["class_info"])

        pairs = []
        for student, number in guardian_numbers(students):
            dues = student_dues(student)
            if dues < min_dues:
                continue
            pairs.append((
                number,
                template.replace("{name}", student.full_name).replace(
                    "{dues}", f"{dues:.2f}"
                ),
            ))
        sent = self.log_and_send(school, "Dues reminder", pairs)
        return Response({"sent": sent, "students": len(pairs)})
