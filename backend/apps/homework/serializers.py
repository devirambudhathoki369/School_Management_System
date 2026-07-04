from rest_framework import serializers

from apps.billing.serializers import TenantChildValidationMixin

from .models import Homework, HomeworkAttachment, Submission, SubmissionAttachment


class HomeworkAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomeworkAttachment
        fields = ["id", "file"]
        read_only_fields = ["id"]


class HomeworkSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("class_info", "subject", "staff")
    attachments = HomeworkAttachmentSerializer(many=True, read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = Homework
        fields = [
            "id", "title", "description", "due_date_bs", "class_info",
            "subject", "subject_name", "staff", "staff_name", "attachments",
        ]
        read_only_fields = ["id"]


class SubmissionAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubmissionAttachment
        fields = ["id", "file"]
        read_only_fields = ["id"]


class SubmissionSerializer(TenantChildValidationMixin, serializers.ModelSerializer):
    tenant_fields = ("student",)
    attachments = SubmissionAttachmentSerializer(many=True, read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = Submission
        fields = [
            "id", "homework", "student", "student_name", "submitted_date_bs",
            "status", "remarks", "attachments",
        ]
        read_only_fields = ["id"]

    def validate_homework(self, homework):
        if homework.school_id != self.context["request"].school.id:
            raise serializers.ValidationError("Does not belong to your school.")
        return homework
