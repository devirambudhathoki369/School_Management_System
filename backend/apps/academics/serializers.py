from rest_framework import serializers

from .models import AcademicYear, Batch, ClassInfo, Course, CurrentYearPointer, Section, Subject


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
        fields = ["id", "name", "education_level", "total_years", "total_semesters"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        years = attrs.get("total_years", getattr(self.instance, "total_years", None))
        semesters = attrs.get(
            "total_semesters", getattr(self.instance, "total_semesters", None)
        )
        if years and semesters:
            raise serializers.ValidationError(
                "A course runs either year-wise or semester-wise — set one, not both."
            )
        return attrs


class BatchSerializer(serializers.ModelSerializer):
    course_name = serializers.CharField(source="course.name", read_only=True, default="")
    education_level = serializers.CharField(
        source="course.education_level", read_only=True, default=""
    )
    start_academic_year_name = serializers.CharField(
        source="start_academic_year.name", read_only=True, default=""
    )

    class Meta:
        model = Batch
        fields = [
            "id", "course", "course_name", "education_level", "year",
            "start_academic_year", "start_academic_year_name",
            "current_semester", "current_year", "graduated",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        sem = attrs.get("current_semester", getattr(self.instance, "current_semester", None))
        yr = attrs.get("current_year", getattr(self.instance, "current_year", None))
        if sem and yr:
            raise serializers.ValidationError(
                "A batch advances either by semester or by year — set one, not both."
            )
        request = self.context.get("request")
        if request is not None:
            for field in ("course", "start_academic_year"):
                value = attrs.get(field)
                if value is not None and value.school_id != request.school.id:
                    raise serializers.ValidationError(
                        {field: "Does not belong to your school."}
                    )
            # school is injected server-side, so DRF can't derive the
            # (school, course, year) unique check — enforce it here.
            course = attrs.get("course", getattr(self.instance, "course", None))
            year = attrs.get("year", getattr(self.instance, "year", None))
            clash = Batch.objects.filter(
                school=request.school, course=course, year=year
            )
            if self.instance is not None:
                clash = clash.exclude(id=self.instance.id)
            if clash.exists():
                raise serializers.ValidationError(
                    {"year": "This intake already exists for the course."}
                )
        return attrs


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
            "year", "semester", "batch", "display_name", "academic_year", "label",
            "students_count",
        ]
        read_only_fields = ["id"]

    def get_students_count(self, obj) -> int:
        # Annotated on the viewset queryset; 0 when built from a bare instance.
        return getattr(obj, "students_count", 0)

    def validate(self, attrs):
        request = self.context.get("request")
        if request is not None:
            for field in ("course", "section", "academic_year", "batch"):
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
