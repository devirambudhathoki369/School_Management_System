"""
Tenant aggregate: School + its settings and branding.

The legacy `main_schooladmin` god-object is split (LEGACY_DATA_MAP.md §4.2):
identity stays on School; operational toggles move to SchoolSettings (typed
columns, not a preferences blob); media/branding to SchoolBranding. Every
tenant-owned row in every other module points at School.
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.models import BaseModel
from apps.identity.models import Account


class Foundation(BaseModel):
    """Umbrella organisation owning one or more schools."""

    name = models.CharField(max_length=100)
    address = models.CharField(max_length=100, blank=True, default="")
    contact = models.CharField(max_length=20, blank=True, default="")
    ceo = models.CharField(max_length=60, blank=True, default="")
    estd_date_bs = models.CharField(max_length=10, blank=True, default="")

    def __str__(self):
        return self.name


class Shareholder(BaseModel):
    # Legacy links shareholders to the school (not the foundation) — preserved.
    school = models.ForeignKey(
        "tenants.School", on_delete=models.CASCADE, related_name="shareholders"
    )
    name = models.CharField(max_length=60)
    contact = models.CharField(max_length=20, blank=True, default="")

    def __str__(self):
        return self.name


class School(BaseModel):
    """The tenant. Everything in the platform is scoped to a School."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=60, unique=True)
    address = models.CharField(max_length=120)
    contact = models.CharField(max_length=20, blank=True, default="")
    telephone = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    pan_no = models.CharField(max_length=20, blank=True, default="")
    estd_date_bs = models.CharField(max_length=10, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    is_test = models.BooleanField(default=False)
    foundation = models.ForeignKey(
        Foundation, null=True, blank=True, on_delete=models.SET_NULL, related_name="schools"
    )
    admin_account = models.OneToOneField(
        Account, null=True, blank=True, on_delete=models.SET_NULL, related_name="school_admin_of"
    )
    legacy_id = models.BigIntegerField(null=True, blank=True, unique=True)

    def __str__(self):
        return self.name


class SchoolSettings(BaseModel):
    """Operational configuration, one row per school, typed columns."""

    school = models.OneToOneField(School, on_delete=models.CASCADE, related_name="settings")
    uses_sms = models.BooleanField(default=False)
    uses_mobile_app = models.BooleanField(default=False)
    timezone = models.CharField(max_length=40, default="Asia/Kathmandu")
    hidden_education_levels = ArrayField(models.CharField(max_length=20), default=list, blank=True)
    # Attendance policy (legacy AT3): when time_set_required is on, a first
    # punch after attendance_in_time is not auto-marked present.
    time_set_required = models.BooleanField(default=False)
    attendance_in_time = models.TimeField(null=True, blank=True)
    attendance_out_time = models.TimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "School settings"

    def __str__(self):
        return f"Settings: {self.school}"


class SchoolBranding(BaseModel):
    """Logos, signatures and public-facing copy used on documents and portals."""

    school = models.OneToOneField(School, on_delete=models.CASCADE, related_name="branding")
    slogan = models.CharField(max_length=120, blank=True, default="")
    about_us = models.TextField(blank=True, default="")
    logo = models.ImageField(upload_to="branding/logo/", null=True, blank=True)
    award_logo = models.ImageField(upload_to="branding/award/", null=True, blank=True)
    principal_sign = models.ImageField(upload_to="branding/sign/", null=True, blank=True)
    exam_coordinator_sign = models.ImageField(upload_to="branding/sign/", null=True, blank=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "School branding"

    def __str__(self):
        return f"Branding: {self.school}"
