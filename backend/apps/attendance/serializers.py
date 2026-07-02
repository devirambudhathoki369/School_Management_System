from rest_framework import serializers

from .models import ClassAttendanceSession, StaffAttendanceRecord, StudentAttendanceRecord


class StudentAttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = StudentAttendanceRecord
        fields = [
            "id", "student", "student_name", "present",
            "checked_in_at", "checked_out_at", "reason",
        ]
        read_only_fields = ["id", "checked_in_at", "checked_out_at"]


class ClassAttendanceSessionSerializer(serializers.ModelSerializer):
    records = StudentAttendanceRecordSerializer(many=True, read_only=True)

    class Meta:
        model = ClassAttendanceSession
        fields = ["id", "date_bs", "class_info", "teacher", "records"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        request = self.context["request"]
        for field in ("class_info", "teacher"):
            value = attrs.get(field)
            if value is not None and value.school_id != request.school.id:
                raise serializers.ValidationError({field: "Does not belong to your school."})
        return attrs


class MarkAttendanceSerializer(serializers.Serializer):
    """Bulk present/absent marking for one session."""

    class RowSerializer(serializers.Serializer):
        student = serializers.UUIDField()
        present = serializers.BooleanField()
        reason = serializers.CharField(
            max_length=50, required=False, allow_blank=True, default=""
        )

    marks = RowSerializer(many=True)

    def save(self):
        session = self.context["session"]
        existing = {r.student_id: r for r in session.records.all()}
        student_ids = {
            s.id for s in session.class_info.students.filter(school=session.school)
        }
        created, updated = [], []
        for mark in self.validated_data["marks"]:
            student_id = mark["student"]
            if student_id not in student_ids:
                raise serializers.ValidationError(
                    {"student": f"{student_id} is not in this class."}
                )
            row = existing.get(student_id)
            if row is None:
                created.append(StudentAttendanceRecord(
                    session=session, student_id=student_id,
                    present=mark["present"], reason=mark.get("reason", ""),
                ))
            else:
                row.present = mark["present"]
                row.reason = mark.get("reason", "")
                updated.append(row)
        StudentAttendanceRecord.objects.bulk_create(created, batch_size=500)
        StudentAttendanceRecord.objects.bulk_update(
            updated, ["present", "reason"], batch_size=500
        )
        return {"created": len(created), "updated": len(updated)}


class StaffAttendanceRecordSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = StaffAttendanceRecord
        fields = [
            "id", "date_bs", "staff", "staff_name", "present",
            "checked_in_at", "checked_out_at", "reason",
        ]
        read_only_fields = ["id", "checked_in_at", "checked_out_at"]

    def validate_staff(self, value):
        if value.school_id != self.context["request"].school.id:
            raise serializers.ValidationError("Does not belong to your school.")
        return value
