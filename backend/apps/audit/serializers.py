from rest_framework import serializers

from .models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = [
            "id", "at", "actor", "actor_name", "action", "object_table",
            "object_id", "changes", "ip_address",
        ]
        read_only_fields = fields  # append-only; written by the platform

    def get_actor_name(self, event) -> str:
        if event.actor_id:
            return event.actor.username
        return event.actor_label
