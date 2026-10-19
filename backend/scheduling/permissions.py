from rest_framework.permissions import BasePermission


class IsBusinessAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_business_admin)


def can_manage(user, appointment) -> bool:
    """Staff can manage their own appointments; admins can manage all of them."""
    if user.is_business_admin:
        return True
    return user.is_staff_member and appointment.staff.user_id == user.id
