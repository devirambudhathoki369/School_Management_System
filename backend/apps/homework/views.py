from apps.core.viewsets import TenantScopedViewSet
from apps.identity.models import Role

from .models import Homework, Submission
from .serializers import HomeworkSerializer, SubmissionSerializer

MANAGERS = (Role.ADMIN, Role.STAFF)


class HomeworkViewSet(TenantScopedViewSet):
    queryset = Homework.objects.select_related("subject", "staff", "class_info")
    serializer_class = HomeworkSerializer
    allowed_roles = MANAGERS
    permission_code = "homework"

    def get_queryset(self):
        qs = super().get_queryset()
        for param in ("class_info", "subject", "staff"):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{param: value})
        if self.action == "retrieve":
            qs = qs.prefetch_related("attachments")
        return qs.order_by("-due_date_bs")


class SubmissionViewSet(TenantScopedViewSet):
    queryset = Submission.objects.select_related("student", "homework")
    serializer_class = SubmissionSerializer
    allowed_roles = MANAGERS
    permission_code = "homework"

    def get_queryset(self):
        qs = super().get_queryset()
        homework = self.request.query_params.get("homework")
        if homework:
            qs = qs.filter(homework=homework)
        return qs
