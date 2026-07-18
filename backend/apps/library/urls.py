from django.urls import path

from apps.core.routers import ApiRouter

from .reports import LibraryReportView

from .views import BookCopyViewSet, BookViewSet, LibraryViewSet, LoanViewSet

router = ApiRouter()
router.register("libraries", LibraryViewSet, basename="library")
router.register("books", BookViewSet, basename="book")
router.register("copies", BookCopyViewSet, basename="book-copy")
router.register("loans", LoanViewSet, basename="loan")

urlpatterns = [
    path("report/", LibraryReportView.as_view(), name="library-report"),
    *router.urls,
]
