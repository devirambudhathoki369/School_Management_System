from rest_framework import serializers

from .models import CalendarEvent, DeliveryLog, MessageTemplate, NewsImage, NewsPost, Notice


class NoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notice
        fields = ["id", "title", "description", "date_bs", "image"]
        read_only_fields = ["id"]


class NewsImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = NewsImage
        fields = ["id", "post", "image"]
        read_only_fields = ["id"]


class NewsPostSerializer(serializers.ModelSerializer):
    images = NewsImageSerializer(many=True, read_only=True)

    class Meta:
        model = NewsPost
        fields = ["id", "title", "content", "images"]
        read_only_fields = ["id"]


class CalendarEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarEvent
        fields = ["id", "start_date_bs", "end_date_bs", "event_type", "color", "description"]
        read_only_fields = ["id"]


class MessageTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageTemplate
        fields = ["id", "kind", "body"]
        read_only_fields = ["id"]


class DeliveryLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryLog
        fields = ["id", "recipient", "title", "body", "data", "status", "sent_at"]
        read_only_fields = fields  # written by senders/importers, never by clients


class SlideImageSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import SlideImage

        model = SlideImage
        fields = ["id", "image", "caption", "order", "active"]
        read_only_fields = ["id"]
