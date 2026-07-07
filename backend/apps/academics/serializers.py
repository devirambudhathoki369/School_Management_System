from rest_framework import serializers

from .models import AcademicYear, ClassInfo, Course, CurrentYearPointer, Section, Subject


class AcademicYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicYear
        fields = ["id", "name", "start_date_bs", "end_date_bs", "closed", "remarks"]
        read_only_fields = ["id", "closed"]  # closing is a dedicated workflow (§14)


class CurrentYearPointerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CurrentYearPointer
        fields = ["id", "key", "academic_year", "previous_academic_year"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        request = self.context.get("request")
        if request is not None:
            for field in ("academic_year", "previous_academic_year"):
                value = attrs.get(field)
                if value is not None and value.school_id != request.school.id:
                    raise serializers.ValidationError(
                        {field: "Does not belong to your school."}
                    )
        return attrs


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ["id", "name", "education_level"]
        read_only_fields = ["id"]


class SectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Section
        fields = ["id", "name"]
        read_only_fields = ["id"]


class ClassInfoSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="__str__", read_only=True)
    students_count = serializers.SerializerMethodField()

    class Meta:
        model = ClassInfo
        fields = [
            "id", "education_level", "grade", "faculty", "course", "section",
            "year", "semester", "display_name", "academic_year", "label",
            "students_count",
        ]
        read_only_fields = ["id"]

    def get_students_count(self, obj) -> int:
        # Annotated on the viewset queryset; 0 when built from a bare instance.
        return getattr(obj, "students_count", 0)

    def validate(self, attrs):
        request = self.context.get("request")
        if request is not None:
            for field in ("course", "section", "academic_year"):
                value = attrs.get(field)
                if value is not None and value.school_id != request.school.id:
                    raise serializers.ValidationError(
                        {field: "Does not belong to your school."}
                    )
        return attrs


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = [
            "id", "class_info", "name", "code", "type", "credit_hours", "order",
            "name_practical", "code_practical", "credit_hours_practical", "is_protected",
        ]
        read_only_fields = ["id"]

    def validate_class_info(self, value):
        request = self.context["request"]
        if value.school_id != request.school.id:
            raise serializers.ValidationError("Class does not belong to your school.")
        return value
