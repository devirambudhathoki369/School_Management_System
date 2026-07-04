"""Communication: notices, news, calendar, message templates and the
delivery log (legacy Notice/NewsEvent/CalendarEvent/SMSTemplate/
NotificationHistory). Notices are push-first by design (§18.14). The
delivery log unifies the legacy (recipient_role, recipient_id) pair into an
identity.Account FK; rows the ETL cannot match keep the legacy pair for
forensics."""

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel, TenantScopedModel


class Notice(TenantScopedModel):
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    date_bs = models.CharField(max_length=10)
    image = models.ImageField(upload_to="notices/", null=True, blank=True)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.title


class NewsPost(TenantScopedModel):
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.title


class NewsImage(BaseModel):
    """School news gallery image. The legacy table had NO post FK (images
    were a school-wide gallery); imported rows keep post null."""

    school = models.ForeignKey("tenants.School", on_delete=models.PROTECT, related_name="+")
    post = models.ForeignKey(
        NewsPost, null=True, blank=True, on_delete=models.CASCADE, related_name="images"
    )
    image = models.ImageField(upload_to="news/%Y/%m/")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.image.name


class CalendarEvent(TenantScopedModel):
    class EventType(models.TextChoices):
        PUBLIC_HOLIDAY = "holiday", "Public holiday"
        EXAM = "exam", "Exam"
        RESULT = "result", "Result"
        EVENT_DAY = "event", "Event day"
        VACATION = "vacation", "Vacation"

    start_date_bs = models.CharField(max_length=10)
    end_date_bs = models.CharField(max_length=10)
    event_type = models.CharField(max_length=10, choices=EventType.choices)
    color = models.CharField(max_length=7, blank=True, default="")
    description = models.TextField(blank=True, default="")
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return f"{self.get_event_type_display()}: {self.start_date_bs}"


class MessageTemplate(TenantScopedModel):
    class Kind(models.TextChoices):
        DUES = "dues", "Dues"
        PAYMENT = "payment", "Payment"
        RESULT = "result", "Result"
        ATTENDANCE = "attendance", "Attendance"
        BIRTHDAY = "birthday", "Birthday"

    kind = models.CharField(max_length=10, choices=Kind.choices)
    body = models.TextField()
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.get_kind_display()


class DeliveryLog(TenantScopedModel):
    """One row per push/SMS delivered (or queued/attempted) to one person."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        STALE_TOKEN = "stale", "Stale token"

    recipient = models.ForeignKey(
        "identity.Account", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # preserved legacy addressing for rows without a matchable account
    legacy_recipient_role = models.CharField(max_length=10, blank=True, default="")
    legacy_recipient_id = models.BigIntegerField(null=True, blank=True)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=500)
    data = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED)
    sent_at = models.DateTimeField(default=timezone.now)
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    class Meta(TenantScopedModel.Meta):
        indexes = [models.Index(fields=["school", "recipient", "sent_at"])]

    def __str__(self):
        return f"{self.title} -> {self.recipient or self.legacy_recipient_id}"
