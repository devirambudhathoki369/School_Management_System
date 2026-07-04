from django.contrib import admin

from .models import Book, BookCopy, Library, Loan


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ["title", "school", "library", "quantity", "price"]
    search_fields = ["title", "personal_author"]
    list_select_related = ["school", "library"]


admin.site.register([Library, BookCopy, Loan])
