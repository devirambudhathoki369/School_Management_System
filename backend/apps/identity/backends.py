"""Role-aware authentication: (role, username) identifies an account."""

from django.contrib.auth.backends import ModelBackend

from .models import Account


class RoleAwareBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, role=None, **kwargs):
        if username is None or password is None:
            return None
        qs = Account.objects.filter(username=username)
        if role is not None:
            qs = qs.filter(role=role)
        account = qs.first()
        if account is None:
            # Burn the same hashing time as a real check (timing-attack parity).
            Account().set_password(password)
            return None
        if account.check_password(password) and self.user_can_authenticate(account):
            return account
        return None
