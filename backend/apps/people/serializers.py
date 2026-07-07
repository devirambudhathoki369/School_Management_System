from rest_framework import serializers

from .models import Guardian, Staff, StaffRole, Student, StudentGuardian


class GuardianSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guardian
        fields = ["id", "name", "contact", "email", "address", "occupation"]
        read_only_fields = ["id"]


class StudentGuardianSerializer(serializers.ModelSerializer):
    guardian = GuardianSerializer(read_only=True)

    class Meta:
        model = StudentGuardian
        fields = ["id", "guardian", "relation", "is_primary_contact"]


class StudentListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    class_label = serializers.CharField(source="class_info.__str__", read_only=True)

    class Meta:
        model = Student
        fields = [
            "id", "full_name", "gender", "status", "roll_no",
            "class_info", "class_label", "contact",
        ]


class StudentDetailSerializer(serializers.ModelSerializer):
    guardians = StudentGuardianSerializer(source="guardian_links", many=True, read_only=True)
    class_label = serializers.CharField(source="class_info.__str__", read_only=True)
    academic_year_name = serializers.CharField(source="academic_year.name", read_only=True)

    class Meta:
        model = Student
        fields = [
            "id", "first_name", "middle_name", "last_name", "birth_date_bs", "gender",
            "email", "contact", "address", "status", "class_info", "academic_year",
            "class_label", "academic_year_name",
            "roll_no", "symbol_no", "regd_no", "emis", "rfid_card",
            "previous_school", "remarks", "ethnicity", "blood_group", "guardians",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        request = self.context["request"]
        for field in ("class_info", "academic_year"):
            value = attrs.get(field)
            if value is not None and value.school_id != request.school.id:
                raise serializers.ValidationError(
                    {field: "Does not belong to your school."}
                )
        return attrs


class StaffRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffRole
        fields = ["id", "name"]
        read_only_fields = ["id"]


class StaffSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)

    def validate_permissions(self, value):
        from apps.core.permissions import permission_codes

        if not isinstance(value, list):
            raise serializers.ValidationError("Must be a list of permission codes.")
        unknown = set(value) - set(permission_codes())
        if unknown:
            raise serializers.ValidationError(f"Unknown permission codes: {sorted(unknown)}")
        return value

    class Meta:
        model = Staff
        fields = [
            "id", "full_name", "first_name", "middle_name", "last_name", "role",
            "role_name", "status", "gender", "birth_date_bs", "email",
            "primary_contact", "secondary_contact", "address", "qualification",
            "joined_date_bs", "rfid_card", "primary_subject", "secondary_subject",
            "permissions",
        ]
        read_only_fields = ["id"]
