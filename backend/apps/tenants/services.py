"""Domain services for the tenant aggregate."""

from apps.identity.models import Account, Role

from .models import School


def resolve_school_for(account: Account) -> School | None:
    """
    The school an account belongs to, derived purely from the principal.

    Admin -> the school whose admin_account is this account.
    Staff/Student/Guardian -> the school of the linked profile (a guardian
    with children in two schools holds one account per school, exactly like
    staff who moonlight — tenancy never spans schools implicitly).
    Super admin -> no implicit tenant (cross-tenant access must be an
    explicit, audited capability — never a default).
    """
    if account.role == Role.ADMIN:
        return School.objects.filter(admin_account=account).first()
    if account.role == Role.STAFF:
        profile = getattr(account, "staff_profile", None)
        return profile.school if profile else None
    if account.role == Role.STUDENT:
        profile = getattr(account, "student_profile", None)
        return profile.school if profile else None
    if account.role == Role.GUARDIAN:
        profile = getattr(account, "guardian_profile", None)
        return profile.school if profile else None
    return None
