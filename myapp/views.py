import json
import secrets
import string
from datetime import timedelta
from pathlib import Path

from django.db import IntegrityError, transaction
from django.http import FileResponse, HttpResponseNotAllowed, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .models import Note

SLUG_ALPHABET = string.ascii_lowercase + string.digits
SLUG_LENGTH = 8
MAX_SLUG_ATTEMPTS = 10
LARGE_FILE_BYTES = 5 * 1024 * 1024
LARGE_FILE_LIFETIME = timedelta(hours=3)


def create_note():
    for _ in range(MAX_SLUG_ATTEMPTS):
        slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        try:
            with transaction.atomic():
                return Note.objects.create(slug=slug)
        except IntegrityError:
            continue
    raise RuntimeError("Could not generate a unique note slug.")


def clear_attachment(note):
    if note.attachment:
        note.attachment.delete(save=False)
    note.attachment = ""
    note.attachment_name = ""
    note.attachment_size = 0
    note.attachment_uploaded_at = None
    note.save(
        update_fields=[
            "attachment",
            "attachment_name",
            "attachment_size",
            "attachment_uploaded_at",
        ]
    )


def remove_expired_attachment(note):
    if (
        note.attachment
        and note.attachment_size > LARGE_FILE_BYTES
        and note.attachment_uploaded_at
        and timezone.now() - note.attachment_uploaded_at >= LARGE_FILE_LIFETIME
    ):
        clear_attachment(note)
        return True
    return False


def attachment_payload(note):
    if not note.attachment:
        return None
    return {
        "name": note.attachment_name,
        "size": note.attachment_size,
        "uploaded_at": note.attachment_uploaded_at.isoformat(),
        "download_url": reverse("download_note_file", kwargs={"slug": note.slug}),
        "expires_at": (
            (note.attachment_uploaded_at + LARGE_FILE_LIFETIME).isoformat()
            if note.attachment_size > LARGE_FILE_BYTES
            else None
        ),
    }


def note_payload(note, changed=None):
    payload = {
        "slug": note.slug,
        "content": note.content,
        "updated_at": note.updated_at.isoformat(),
        "attachment": attachment_payload(note),
    }
    if changed is not None:
        payload["changed"] = changed
    return payload


def home(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    note = create_note()
    return redirect("note_detail", slug=note.slug)


@ensure_csrf_cookie
def note_detail(request, slug):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    note = get_object_or_404(Note, slug=slug)
    remove_expired_attachment(note)
    return render(request, "myapp/note.html", {"note": note})


@require_http_methods(["GET", "POST"])
def note_api(request, slug):
    note = get_object_or_404(Note, slug=slug)
    remove_expired_attachment(note)

    if request.method == "GET":
        return JsonResponse(note_payload(note))

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"error": "JSON body must be an object."}, status=400)

    content = payload.get("content")
    if not isinstance(content, str):
        return JsonResponse({"error": "Content must be a string."}, status=400)

    changed = content != note.content
    if changed:
        note.content = content
        note.save(update_fields=["content", "updated_at"])

    return JsonResponse(note_payload(note, changed=changed))


@require_http_methods(["POST", "DELETE"])
def note_file(request, slug):
    with transaction.atomic():
        note = get_object_or_404(Note.objects.select_for_update(), slug=slug)
        remove_expired_attachment(note)

        if request.method == "DELETE":
            if note.attachment:
                clear_attachment(note)
            return JsonResponse({"attachment": None})

        if note.attachment:
            return JsonResponse(
                {"error": "Delete the current file before uploading another."},
                status=409,
            )

        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            return JsonResponse({"error": "Choose a file to upload."}, status=400)

        note.attachment = uploaded_file
        note.attachment_name = Path(uploaded_file.name).name[:255]
        note.attachment_size = uploaded_file.size
        note.attachment_uploaded_at = timezone.now()
        note.save(
            update_fields=[
                "attachment",
                "attachment_name",
                "attachment_size",
                "attachment_uploaded_at",
            ]
        )

    return JsonResponse({"attachment": attachment_payload(note)}, status=201)


@require_http_methods(["GET"])
def download_note_file(request, slug):
    note = get_object_or_404(Note, slug=slug)
    remove_expired_attachment(note)
    if not note.attachment:
        return JsonResponse({"error": "No file is attached."}, status=404)

    try:
        file_handle = note.attachment.open("rb")
    except FileNotFoundError:
        clear_attachment(note)
        return JsonResponse({"error": "The attached file is unavailable."}, status=404)

    return FileResponse(
        file_handle,
        as_attachment=True,
        filename=note.attachment_name,
    )
