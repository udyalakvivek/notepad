import secrets
from pathlib import Path

from django.db import models


def attachment_upload_path(instance, filename):
    suffix = Path(filename).suffix[:16]
    return f"notes/{instance.slug}/{secrets.token_hex(16)}{suffix}"


class Note(models.Model):
    slug = models.CharField(max_length=20, unique=True)
    content = models.TextField(blank=True)
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
