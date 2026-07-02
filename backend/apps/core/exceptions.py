"""Uniform API error envelope: {"error": {"code", "message", "details"}}."""

import logging

from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        # Unhandled exception: let Django's 500 machinery report it, but log
        # with the failing view for traceability.
        logger.exception("Unhandled API exception in %s", context.get("view"))
        return None

    detail = response.data
    message = detail.get("detail") if isinstance(detail, dict) else None
    response.data = {
        "error": {
            "code": getattr(exc, "default_code", "error"),
            "message": str(message) if message else "Validation failed.",
            "details": None if message else detail,
        }
    }
    return response
