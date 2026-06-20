import secrets
from pathlib import Path

from django.db import models


def attachment_upload_path(instance, filename):
    suffix = Path(filename).suffix[:16]
    return f"notes/{instance.slug}/{secrets.token_hex(16)}{suffix}"


class Note(models.Model):
    slug = models.CharField(max_length=20, unique=True)
    content = models.TextField(blank=True)
    password = models.CharField(max_length=128, blank=True)
    attachment = models.FileField(upload_to=attachment_upload_path, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_size = models.PositiveBigIntegerField(default=0)
    attachment_uploaded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.slug


class NoteHistory(models.Model):
    note = models.ForeignKey(Note, on_delete=models.CASCADE, related_name="history")
    content = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.note.slug} @ {self.created_at:%Y-%m-%d %H:%M:%S}"

