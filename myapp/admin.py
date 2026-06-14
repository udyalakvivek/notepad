from django.contrib import admin

from .models import Note


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("slug", "attachment_name", "created_at", "updated_at")
    search_fields = ("slug", "content")
    readonly_fields = (
        "attachment_size",
        "attachment_uploaded_at",
        "created_at",
        "updated_at",
    )
