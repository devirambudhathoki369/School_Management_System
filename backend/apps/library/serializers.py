from rest_framework import serializers

from apps.billing.serializers import TenantChildValidationMixin

from .models import Book, BookCopy, Library, Loan


class LibrarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Library
        fields = [
            "id", "name", "address", "contacts", "fine_per_day",
            "fine_on_damage", "shared_with",
        ]
        read_only_fields = ["id", "shared_with"]  # sharing is a vendor action


class BookSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("library", "class_info")

    class Meta:
        model = Book
        fields = [
            "id", "library", "entry_date_bs", "class_info", "title", "edition",
            "place_and_publisher", "isbn_no", "source", "pages", "quantity",
            "price", "published_year", "broad_subject",
            "geographical_descriptions", "keywords", "note", "vendor",
            "vendor_contact", "call_no", "personal_author", "corporate_author",
        ]
        read_only_fields = ["id"]


class BookCopySerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("book",)
    book_title = serializers.CharField(source="book.title", read_only=True)

    class Meta:
        model = BookCopy
        fields = [
            "id", "book", "book_title", "accession_no", "entry_date_bs",
            "is_lost", "is_damaged", "remarks",
        ]
        read_only_fields = ["id"]

    def validate_accession_no(self, value):
        # the (school, accession_no) constraint can't be auto-validated —
        # school comes from the principal, not the payload
        qs = BookCopy.objects.filter(
            school=self.context["request"].school, accession_no=value
        )
        if self.instance is not None:
            qs = qs.exclude(id=self.instance.id)
        if qs.exists():
            raise serializers.ValidationError("Accession number already in use.")
        return value


class LoanSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("copy", "student", "staff")

    class Meta:
        model = Loan
        fields = [
            "id", "copy", "student", "staff", "issued_date_bs", "due_date_bs",
            "returned_date_bs", "fine_amount", "remarks",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("student") is None and attrs.get("staff") is None:
            raise serializers.ValidationError("A loan needs a borrower (student or staff).")
        return attrs
