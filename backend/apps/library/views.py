from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import Book, BookCopy, Library, Loan
from .serializers import BookCopySerializer, BookSerializer, LibrarySerializer, LoanSerializer

MANAGERS = (Role.ADMIN, Role.STAFF)


class LibraryViewSet(TenantScopedViewSet):
    queryset = Library.objects.all()
    serializer_class = LibrarySerializer
    allowed_roles = MANAGERS
    permission_code = "library"


class BookViewSet(TenantScopedViewSet):
    queryset = Book.objects.select_related("library")
    serializer_class = BookSerializer
    allowed_roles = MANAGERS
    permission_code = "library"

    def get_queryset(self):
        qs = super().get_queryset()
        library = self.request.query_params.get("library")
        if library:
            qs = qs.filter(library=library)
        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(title__icontains=search) | qs.filter(
                personal_author__icontains=search
            )
        return qs.order_by("title")


class BookCopyViewSet(TenantScopedViewSet):
    queryset = BookCopy.objects.select_related("book")
    serializer_class = BookCopySerializer
    allowed_roles = MANAGERS
    permission_code = "library"

    def get_queryset(self):
        qs = super().get_queryset()
        book = self.request.query_params.get("book")
        if book:
            qs = qs.filter(book=book)
        return qs.order_by("accession_no")


class LoanViewSet(TenantScopedViewSet):
    queryset = Loan.objects.select_related("copy__book", "student", "staff")
    serializer_class = LoanSerializer
    allowed_roles = MANAGERS
    permission_code = "library"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("student", "staff", "copy"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.request.query_params.get("open") == "true":
            qs = qs.filter(returned_date_bs="")
        return qs.order_by("-issued_date_bs")
