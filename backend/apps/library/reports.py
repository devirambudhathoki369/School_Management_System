"""
Library reports — the eight legacy leaves served from one endpoint.

GET /api/v1/library/report/?kind=<kind>[&from_bs=&to_bs=&member=&member_type=]

kinds:
- overall           stock + circulation totals per library
- daily             loans issued/returned in the window (default today)
- issued_students   open loans held by students
- issued_teachers   open loans held by staff
- counts            issued vs returned totals per day in the window
- operation         every loan event in the window (issue + return rows)
- fine              returned loans that charged a fine
- member            one borrower's full history (member profile)
"""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Q, Sum
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.dates import today_bs
from apps.core.permissions import ModulePermissionAllowed, RoleAllowed
from apps.identity.models import Role
from apps.tenants.services import resolve_school_for

from .models import Book, BookCopy, Library, Loan

ZERO = Decimal("0")


def loan_row(loan) -> dict:
    borrower = loan.student or loan.staff
    return {
        "id": str(loan.id),
        "accession_no": loan.copy.accession_no,
        "book": loan.copy.book.title,
        "borrower": borrower.full_name if borrower else "",
        "borrower_type": "student" if loan.student_id else "staff",
        "issued_date_bs": loan.issued_date_bs,
        "due_date_bs": loan.due_date_bs,
        "returned_date_bs": loan.returned_date_bs,
        "fine": loan.fine_amount,
    }


class LibraryReportView(APIView):
    permission_classes = [IsAuthenticated, RoleAllowed, ModulePermissionAllowed]
    allowed_roles = (Role.ADMIN, Role.STAFF)
    permission_code = "library"

    def get(self, request):
        school = resolve_school_for(request.user)
        if school is None:
            raise PermissionDenied("No school is associated with this account.")
        kind = request.query_params.get("kind") or "overall"
        handler = getattr(self, f"kind_{kind}", None)
        if handler is None:
            raise ValidationError({"kind": "Unknown report kind."})
        return handler(request, school)

    # window helper: default = today only
    def window(self, request):
        from_bs = request.query_params.get("from_bs") or today_bs()
        to_bs = request.query_params.get("to_bs") or from_bs
        return from_bs, to_bs

    def loans(self, school):
        return Loan.objects.filter(school=school).select_related(
            "copy__book", "student", "staff"
        )

    def kind_overall(self, request, school):
        rows = []
        for library in Library.objects.filter(school=school):
            copies = BookCopy.objects.filter(school=school, book__library=library)
            loans = Loan.objects.filter(school=school, copy__book__library=library)
            open_loans = loans.filter(returned_date_bs="")
            rows.append({
                "library": library.name,
                "titles": Book.objects.filter(school=school, library=library).count(),
                "copies": copies.count(),
                "issued_now": open_loans.count(),
                "available": copies.count() - open_loans.count(),
                "loans_ever": loans.count(),
                "fines_collected": loans.aggregate(f=Sum("fine_amount"))["f"] or ZERO,
            })
        return Response({"rows": rows})

    def kind_daily(self, request, school):
        from_bs, to_bs = self.window(request)
        issued = self.loans(school).filter(
            issued_date_bs__gte=from_bs, issued_date_bs__lte=to_bs
        )
        returned = self.loans(school).filter(
            returned_date_bs__gte=from_bs, returned_date_bs__lte=to_bs
        )
        return Response({
            "issued": [loan_row(loan) for loan in issued],
            "returned": [loan_row(loan) for loan in returned],
        })

    def _issued_open(self, school, borrower: str):
        q = Q(returned_date_bs="")
        q &= Q(student__isnull=False) if borrower == "student" else Q(staff__isnull=False)
        return Response({
            "rows": [loan_row(loan) for loan in self.loans(school).filter(q)]
        })

    def kind_issued_students(self, request, school):
        return self._issued_open(school, "student")

    def kind_issued_teachers(self, request, school):
        return self._issued_open(school, "staff")

    def kind_counts(self, request, school):
        from_bs, to_bs = self.window(request)
        per_day: dict = defaultdict(lambda: {"issued": 0, "returned": 0})
        for date, n in (
            self.loans(school)
            .filter(issued_date_bs__gte=from_bs, issued_date_bs__lte=to_bs)
            .values_list("issued_date_bs")
            .annotate(n=Count("id"))
        ):
            per_day[date]["issued"] = n
        for date, n in (
            self.loans(school)
            .filter(returned_date_bs__gte=from_bs, returned_date_bs__lte=to_bs)
            .values_list("returned_date_bs")
            .annotate(n=Count("id"))
        ):
            per_day[date]["returned"] = n
        rows = [
            {"date_bs": date, **counts} for date, counts in sorted(per_day.items())
        ]
        return Response({"rows": rows})

    def kind_operation(self, request, school):
        from_bs, to_bs = self.window(request)
        q = Q(issued_date_bs__gte=from_bs, issued_date_bs__lte=to_bs) | Q(
            returned_date_bs__gte=from_bs, returned_date_bs__lte=to_bs
        )
        return Response({
            "rows": [loan_row(loan) for loan in self.loans(school).filter(q)]
        })

    def kind_fine(self, request, school):
        loans = self.loans(school).filter(fine_amount__gt=0)
        return Response({
            "rows": [loan_row(loan) for loan in loans],
            "total": loans.aggregate(f=Sum("fine_amount"))["f"] or ZERO,
        })

    def kind_member(self, request, school):
        member = request.query_params.get("member")
        member_type = request.query_params.get("member_type") or "student"
        if not member:
            raise ValidationError({"member": "Pick a member."})
        q = Q(student=member) if member_type == "student" else Q(staff=member)
        loans = self.loans(school).filter(q).order_by("-issued_date_bs")
        return Response({
            "rows": [loan_row(loan) for loan in loans],
            "open": loans.filter(returned_date_bs="").count(),
            "fines": loans.aggregate(f=Sum("fine_amount"))["f"] or ZERO,
        })
