"""Every School must always have its settings and branding rows."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import School, SchoolBranding, SchoolSettings


@receiver(post_save, sender=School)
def ensure_school_satellites(sender, instance, created, **kwargs):
    if created:
        SchoolSettings.objects.get_or_create(school=instance)
        SchoolBranding.objects.get_or_create(school=instance)
