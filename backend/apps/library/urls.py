from rest_framework.routers import DefaultRouter

from .views import BookCopyViewSet, BookViewSet, LibraryViewSet, LoanViewSet

router = DefaultRouter()
router.register("libraries", LibraryViewSet, basename="library")
router.register("books", BookViewSet, basename="book")
router.register("copies", BookCopyViewSet, basename="book-copy")
router.register("loans", LoanViewSet, basename="loan")

urlpatterns = router.urls
