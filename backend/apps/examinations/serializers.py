from rest_framework import serializers

from apps.identity.models import Role

from .models import (
    ActivityDefinition,
    ActivityGrade,
    CharacterCertificate,
    Exam,
    ExamScheduleEntry,
    GradeBand,
    GradingScheme,
    SeatAllocation,
    SeatPlanRoom,
    SeatPlanRoomClass,
    StudentSubjectResult,
    SubjectResultSheet,
)
from .services import certificates
from .services.grading import compute_marks


class TenantChildValidationMixin:
    """Rejects FK values that belong to another school."""

    tenant_fields: tuple[str, ...] = ()

    def validate(self, attrs):
        request = self.context["request"]
        for field in self.tenant_fields:
            value = attrs.get(field)
            if value is not None and value.school_id != request.school.id:
                raise serializers.ValidationError({field: "Does not belong to your school."})
        return attrs


class ExamSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("academic_year",)

    class Meta:
        model = Exam
        fields = ["id", "name", "academic_year", "inclusion_weight", "include_attendance"]
        read_only_fields = ["id"]


class ExamScheduleEntrySerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("exam", "class_info", "subject")
    subject_name = serializers.CharField(source="subject.name", read_only=True)

    class Meta:
        model = ExamScheduleEntry
        fields = [
            "id", "exam", "class_info", "subject", "subject_name",
            "exam_date_bs", "start_time", "end_time",
        ]
        read_only_fields = ["id"]


class GradeBandSerializer(serializers.ModelSerializer):
    class Meta:
        model = GradeBand
        fields = ["id", "min_score", "max_score", "remarks"]
        read_only_fields = ["id"]


class GradingSchemeSerializer(serializers.ModelSerializer):
    bands = GradeBandSerializer(many=True)

    class Meta:
        model = GradingScheme
        fields = ["id", "type", "bands"]
        read_only_fields = ["id"]

    def validate_bands(self, bands):
        for band in bands:
            if band["min_score"] > band["max_score"]:
                raise serializers.ValidationError("Band min must not exceed max.")
        return bands

    def create(self, validated_data):
        bands = validated_data.pop("bands")
        scheme = GradingScheme.objects.create(**validated_data)
        self._write_bands(scheme, bands)
        return scheme

    def update(self, instance, validated_data):
        bands = validated_data.pop("bands", None)
        instance = super().update(instance, validated_data)
        if bands is not None:
            instance.bands.all().delete()
            self._write_bands(instance, bands)
        return instance

    @staticmethod
    def _write_bands(scheme, bands):
        GradeBand.objects.bulk_create(
            GradeBand(scheme=scheme, school_id=scheme.school_id, **band) for band in bands
        )


class StudentMarkSerializer(serializers.ModelSerializer):
    """total/passed are always computed server-side (never client input)."""

    student_name = serializers.CharField(source="student.full_name", read_only=True)
    roll_no = serializers.CharField(source="student.roll_no", read_only=True)

    class Meta:
        model = StudentSubjectResult
        fields = [
            "id", "student", "student_name", "roll_no", "theory", "practical",
            "total", "inclusion", "attendance_days", "passed", "absent",
            "position_in_section", "position_in_class",
        ]
        read_only_fields = ["id", "total", "passed", "position_in_section", "position_in_class"]


class SubjectResultSheetSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("exam", "class_info", "subject")
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    is_published = serializers.BooleanField(read_only=True)

    class Meta:
        model = SubjectResultSheet
        fields = [
            "id", "exam", "class_info", "subject", "subject_name",
            "full_marks", "pass_marks", "full_marks_theory", "pass_marks_theory",
            "full_marks_practical", "pass_marks_practical", "attendance_days",
            "published_date_bs", "is_published",
        ]
        read_only_fields = ["id", "published_date_bs"]  # publishing is a dedicated action

    def validate(self, attrs):
        attrs = super().validate(attrs)
        full = attrs.get("full_marks", getattr(self.instance, "full_marks", None))
        passing = attrs.get("pass_marks", getattr(self.instance, "pass_marks", None))
        if full is not None and passing is not None and passing > full:
            raise serializers.ValidationError("Pass marks cannot exceed full marks.")
        return attrs


class MarksEntrySerializer(serializers.Serializer):
    """Bulk marks upsert for one sheet. Staff cannot touch published sheets."""

    marks = StudentMarkSerializer(many=True)

    def validate(self, attrs):
        request = self.context["request"]
        sheet = self.context["sheet"]
        if sheet.is_published and request.user.role != Role.ADMIN:
            raise serializers.ValidationError(
                "This result is published; only the school admin may amend it."
            )
        for mark in attrs["marks"]:
            student = mark["student"]
            if student.school_id != request.school.id:
                raise serializers.ValidationError("Student does not belong to your school.")
        return attrs

    def save(self):
        sheet = self.context["sheet"]
        existing = {r.student_id: r for r in sheet.results.all()}
        created, updated = [], []
        for mark in self.validated_data["marks"]:
            student = mark["student"]
            absent = mark.get("absent") or False
            total, passed = compute_marks(
                theory=mark.get("theory"), practical=mark.get("practical"),
                absent=absent, sheet=sheet,
            )
            row = existing.get(student.id)
            if row is None:
                created.append(StudentSubjectResult(
                    sheet=sheet, school_id=sheet.school_id, student=student,
                    theory=mark.get("theory"), practical=mark.get("practical"),
                    inclusion=mark.get("inclusion"),
                    attendance_days=mark.get("attendance_days"),
                    absent=absent, total=total, passed=passed,
                ))
            else:
                row.theory = mark.get("theory")
                row.practical = mark.get("practical")
                row.inclusion = mark.get("inclusion")
                row.attendance_days = mark.get("attendance_days")
                row.absent = absent
                row.total, row.passed = total, passed
                updated.append(row)
        StudentSubjectResult.objects.bulk_create(created, batch_size=1000)
        StudentSubjectResult.objects.bulk_update(
            updated,
            ["theory", "practical", "inclusion", "attendance_days", "absent", "total", "passed"],
            batch_size=1000,
        )
        return {"created": len(created), "updated": len(updated)}


class ActivityDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityDefinition
        fields = ["id", "name"]
        read_only_fields = ["id"]


class ActivityGradeSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("exam", "class_info", "student", "activity")

    class Meta:
        model = ActivityGrade
        fields = ["id", "exam", "class_info", "student", "activity", "grade"]
        read_only_fields = ["id"]


class CharacterCertificateSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student",)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    created_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = CharacterCertificate
        # serial_no is allocated server-side (legacy let the client post it,
        # which is how malformed serials got into production).
        fields = ["id", "serial_no", "student", "student_name", "data", "created_at"]
        read_only_fields = ["id", "serial_no"]

    def create(self, validated_data):
        return certificates.issue(
            school=validated_data["school"],
            student=validated_data.get("student"),
            data=validated_data["data"],
        )


class SeatAllocationSerializer(serializers.ModelSerializer):
    """Read-only seat rows; names ride along so the chart needs no student grant."""

    name = serializers.CharField(source="student.full_name", read_only=True)
    roll_no = serializers.CharField(source="student.roll_no", read_only=True)
    symbol_no = serializers.CharField(source="student.symbol_no", read_only=True)
    regd_no = serializers.CharField(source="student.regd_no", read_only=True)

    class Meta:
        model = SeatAllocation
        fields = [
            "id", "student", "class_info", "bench_no", "column", "sequence",
            "name", "roll_no", "symbol_no", "regd_no",
        ]
        read_only_fields = fields


class SeatPlanRoomClassSerializer(serializers.ModelSerializer):
    class Meta:
        model = SeatPlanRoomClass
        fields = ["id", "class_info", "column", "order_by"]
        read_only_fields = ["id"]


class SeatPlanRoomSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("exam",)
    classes = SeatPlanRoomClassSerializer(source="room_classes", many=True)
    allocations = SeatAllocationSerializer(many=True, read_only=True)
    capacity = serializers.IntegerField(read_only=True)

    class Meta:
        model = SeatPlanRoom
        fields = [
            "id", "exam", "name", "benches", "seats_per_bench", "order_by",
            "note", "capacity", "classes", "allocations",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context["request"]
        seats = attrs.get("seats_per_bench", getattr(self.instance, "seats_per_bench", 2))
        classes = attrs.get("room_classes")
        if classes is not None:
            columns = [c["column"] for c in classes]
            if len(set(columns)) != len(columns):
                raise serializers.ValidationError(
                    {"classes": "One class per bench column — columns must be unique."}
                )
            for entry in classes:
                if not 1 <= entry["column"] <= seats:
                    raise serializers.ValidationError(
                        {"classes": f"Column {entry['column']} is outside 1–{seats}."}
                    )
                if entry["class_info"].school_id != request.school.id:
                    raise serializers.ValidationError(
                        {"classes": "Class does not belong to your school."}
                    )
        return attrs

    def create(self, validated_data):
        classes = validated_data.pop("room_classes")
        room = SeatPlanRoom.objects.create(**validated_data)
        self._write_classes(room, classes)
        return room

    def update(self, instance, validated_data):
        classes = validated_data.pop("room_classes", None)
        instance = super().update(instance, validated_data)
        if classes is not None:
            # Replace wholesale (legacy contract); allocations survive until
            # the next generate run replaces them too.
            instance.room_classes(manager="all_objects").all().delete()
            self._write_classes(instance, classes)
        return instance

    @staticmethod
    def _write_classes(room, classes):
        SeatPlanRoomClass.objects.bulk_create(
            SeatPlanRoomClass(room=room, school_id=room.school_id, **entry)
            for entry in classes
        )
