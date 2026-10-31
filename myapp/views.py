import json
import re
import secrets
import string
from datetime import timedelta
from pathlib import Path

from django.db import IntegrityError, transaction
from django.http import FileResponse, HttpResponseNotAllowed
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from .s3_client import s3_client
from django.conf import settings
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes
from rest_framework.response import Response
from .models import Note, NoteHistory
from .utils import upload_to_s3, delete_from_s3, get_s3_file, upload_s3

SLUG_ALPHABET = string.ascii_lowercase + string.digits
SLUG_LENGTH = 8
MAX_SLUG_ATTEMPTS = 10
LARGE_FILE_BYTES = 5 * 1024 * 1024
LARGE_FILE_LIFETIME = timedelta(hours=3)
MAX_NOTE_LINES = 5000
MAX_NOTE_HISTORY = 10
NOTE_HISTORY_LIFETIME = timedelta(hours=1)
NOTE_HISTORY_SNAPSHOT_DELAY = timedelta(minutes=2)
STATIC_NOTE_SLUGS = [
    "quick-note",
    "daily-note",
    "work-note",
    "avendus-note",
    "avendus-cmd-note",
    "todo-note",
    "links-note",
    "meeting-note",
    "draft-note",
    "archive-note",
]


def unlock_session_key(note):
    return f"note-unlocked:{note.slug}"


def is_note_unlocked(request, note):
    return not note.password or request.session.get(unlock_session_key(note)) is True


# DRF's SessionAuthentication enforces CSRF for authenticated users only. These
# APIs are anonymous, so this subclass preserves the existing CSRF checks;
# note_detail still uses ensure_csrf_cookie to give the frontend its token.
class CsrfSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        authenticated = super().authenticate(request)
        if authenticated is None:
            self.enforce_csrf(request)
        return authenticated


def history_preview(content):
    first_line = content.strip().splitlines()[0] if content.strip() else "Empty note"
    if len(first_line) > 42:
        return f"{first_line[:39]}..."
    return first_line


def history_payload(history):
    return {
        "id": history.id,
        "created_at": history.created_at.isoformat(),
        "preview": history_preview(history.content),
        "characters": len(history.content),
        "content": history.content,
    }


def recent_history_queryset(note):
    return note.history.filter(
        created_at__gte=timezone.now() - NOTE_HISTORY_LIFETIME
    )


def cleanup_note_history(note):
    note.history.filter(
        created_at__lt=timezone.now() - NOTE_HISTORY_LIFETIME
    ).delete()
    stale_ids = list(
        recent_history_queryset(note).values_list("id", flat=True)[MAX_NOTE_HISTORY:]
    )
    if stale_ids:
        NoteHistory.objects.filter(id__in=stale_ids).delete()


def create_history_snapshot(note):
    cleanup_note_history(note)
    latest = recent_history_queryset(note).first()
    if latest and latest.content == note.content:
        return
    if latest and timezone.now() - latest.created_at < NOTE_HISTORY_SNAPSHOT_DELAY:
        return
    NoteHistory.objects.create(note=note, content=note.content)
    cleanup_note_history(note)


def create_anonymous_note():
    for _ in range(MAX_SLUG_ATTEMPTS):
        slug = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
        try:
            with transaction.atomic():
                return Note.objects.create(slug=slug)
        except IntegrityError:
            continue
    raise RuntimeError("Could not generate a unique note slug.")


def get_note_for_slug(slug):
    if slug in STATIC_NOTE_SLUGS:
        note, _ = Note.objects.get_or_create(slug=slug)
        return note
    return get_object_or_404(Note, slug=slug)


def ensure_static_notes():
    existing_slugs = set(
        Note.objects.filter(slug__in=STATIC_NOTE_SLUGS).values_list("slug", flat=True)
    )
    Note.objects.bulk_create(
        [Note(slug=slug) for slug in STATIC_NOTE_SLUGS if slug not in existing_slugs],
        ignore_conflicts=True,
    )


def clear_attachment(note):
    if note.attachment:
        delete_from_s3(note.attachment.name)
        try:
            note.attachment.delete(save=False)
        except Exception:
            pass
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
        "title": note.title,
        "content": note.content,
        "text_color": note.text_color,
        "text_weight": note.text_weight,
        "updated_at": note.updated_at.isoformat(),
        "attachment": attachment_payload(note),
        "has_password": bool(note.password),
    }
    if changed is not None:
        payload["changed"] = changed
    return payload


def home(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    ensure_static_notes()
    note = create_anonymous_note()
    return redirect("note_detail", slug=note.slug)


@ensure_csrf_cookie
def note_detail(request, slug):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    note = get_note_for_slug(slug)
    remove_expired_attachment(note)
    locked = not is_note_unlocked(request, note)
    return render(
        request,
        "myapp/note.html",
        {
            "note": note,
            "static_note_slugs": STATIC_NOTE_SLUGS,
            "locked": locked,
            "has_password": bool(note.password),
        },
    )


@api_view(["GET", "POST"])
@authentication_classes([CsrfSessionAuthentication])
def note_api(request, slug):
    note = get_note_for_slug(slug)
    remove_expired_attachment(note)

    if not is_note_unlocked(request, note):
        return Response(
            {"error": "This note is locked.", "locked": True},
            status=status.HTTP_423_LOCKED,
        )

    if request.method == "GET":
        return Response(note_payload(note))

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(
            {"error": "Invalid JSON body."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not isinstance(payload, dict):
        return Response(
            {"error": "JSON body must be an object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    content = payload.get("content", note.content)
    if not isinstance(content, str):
        return Response(
            {"error": "Content must be a string."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    title = payload.get("title", note.title)
    if not isinstance(title, str):
        return Response(
            {"error": "Title must be a string."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    title = title.strip()
    if len(title) > 120:
        return Response(
            {"error": "Title cannot exceed 120 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    text_color = payload.get("text_color", note.text_color)
    if not isinstance(text_color, str) or not (
        text_color == "default" or re.fullmatch(r"#[0-9a-fA-F]{6}", text_color)
    ):
        return Response(
            {"error": "Choose a valid text color."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    text_weight = payload.get("text_weight", note.text_weight)
    if type(text_weight) is not int or text_weight not in {400, 500, 700}:
        return Response(
            {"error": "Choose a valid text thickness."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    line_count = content.count("\n") + 1 if content else 0
    if line_count > MAX_NOTE_LINES:
        return Response(
            {"error": f"Content cannot be more than {MAX_NOTE_LINES} lines."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    content_changed = content != note.content
    title_changed = title != note.title
    style_changed = text_color != note.text_color or text_weight != note.text_weight
    if content_changed:
        create_history_snapshot(note)

    if content_changed or title_changed or style_changed:
        note.content = content
        note.title = title
        note.text_color = text_color
        note.text_weight = text_weight
        note.save(
            update_fields=[
                "content",
                "title",
                "text_color",
                "text_weight",
                "updated_at",
            ]
        )

    changed = content_changed or title_changed or style_changed
    return Response(note_payload(note, changed=changed))


@api_view(["POST", "DELETE"])
@authentication_classes([CsrfSessionAuthentication])
def note_file(request, slug):
    with transaction.atomic():
        if slug in STATIC_NOTE_SLUGS:
            Note.objects.get_or_create(slug=slug)
        note = get_object_or_404(Note.objects.select_for_update(), slug=slug)
        remove_expired_attachment(note)
        if not is_note_unlocked(request, note):
            return Response(
                {"error": "This note is locked.", "locked": True},
                status=status.HTTP_423_LOCKED,
            )

        if request.method == "DELETE":
            if note.attachment:
                clear_attachment(note)
            return Response({"attachment": None})

        if note.attachment:
            return Response(
                {"error": "Delete the current file before uploading another."},
                status=status.HTTP_409_CONFLICT,
            )

        uploaded_file = request.FILES.get("file")
        if uploaded_file is None:
            return Response(
                {"error": "Choose a file to upload."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file_key, err = upload_to_s3(uploaded_file, note.slug)
        if file_key:
            note.attachment = file_key
        elif isinstance(err, Response):
            return err
        else:
            uploaded_file.seek(0)
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

    return Response(
        {"attachment": attachment_payload(note)},
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@authentication_classes([CsrfSessionAuthentication])
def download_note_file(request, slug):
    note = get_note_for_slug(slug)
    remove_expired_attachment(note)
    if not is_note_unlocked(request, note):
        return Response(
            {"error": "This note is locked.", "locked": True},
            status=status.HTTP_423_LOCKED,
        )
    if not note.attachment:
        return Response(
            {"error": "No file is attached."},
            status=status.HTTP_404_NOT_FOUND,
        )

    # 1. Fetch from S3 if object exists on S3
    s3_stream, content_type = get_s3_file(note.attachment.name)
    if s3_stream:
        return FileResponse(
            s3_stream,
            as_attachment=True,
            filename=note.attachment_name,
            content_type=content_type,
        )

    # 2. Fallback to local storage (if stored locally)
    try:
        file_handle = note.attachment.open("rb")
        return FileResponse(
            file_handle,
            as_attachment=True,
            filename=note.attachment_name,
        )
    except Exception:
        clear_attachment(note)
        return Response(
            {"error": "The attached file is unavailable."},
            status=status.HTTP_404_NOT_FOUND,
        )


@api_view(["POST"])
@authentication_classes([CsrfSessionAuthentication])
def note_unlock(request, slug):
    note = get_note_for_slug(slug)
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(
            {"error": "Invalid JSON body."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str):
        return Response(
            {"error": "Password must be a string."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not note.password or password == note.password:
        request.session[unlock_session_key(note)] = True
        request.session.modified = True
        remove_expired_attachment(note)
        return Response(note_payload(note))

    return Response(
        {"error": "Wrong password."},
        status=status.HTTP_403_FORBIDDEN,
    )


@api_view(["POST", "DELETE"])
@authentication_classes([CsrfSessionAuthentication])
def note_password(request, slug):
    note = get_note_for_slug(slug)
    if not is_note_unlocked(request, note):
        return Response(
            {"error": "This note is locked.", "locked": True},
            status=status.HTTP_423_LOCKED,
        )

    if request.method == "DELETE":
        note.password = ""
        note.save(update_fields=["password", "updated_at"])
        request.session.pop(unlock_session_key(note), None)
        request.session.modified = True
        return Response({"has_password": False})

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(
            {"error": "Invalid JSON body."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str):
        return Response(
            {"error": "Password must be a string."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    password = password.strip()
    if not password:
        return Response(
            {"error": "Enter a password."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    note.password = password[:128]
    note.save(update_fields=["password", "updated_at"])
    request.session[unlock_session_key(note)] = True
    request.session.modified = True
    return Response({"has_password": True})


@api_view(["GET", "POST"])
@authentication_classes([CsrfSessionAuthentication])
def note_history(request, slug):
    note = get_note_for_slug(slug)
    if not is_note_unlocked(request, note):
        return Response(
            {"error": "This note is locked.", "locked": True},
            status=status.HTTP_423_LOCKED,
        )

    if request.method == "GET":
        cleanup_note_history(note)
        histories = recent_history_queryset(note)[:MAX_NOTE_HISTORY]
        return Response({"history": [history_payload(item) for item in histories]})

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(
            {"error": "Invalid JSON body."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    history_id = payload.get("history_id") if isinstance(payload, dict) else None
    cleanup_note_history(note)
    history = get_object_or_404(
        NoteHistory,
        id=history_id,
        note=note,
        created_at__gte=timezone.now() - NOTE_HISTORY_LIFETIME,
    )
    if history.content != note.content:
        create_history_snapshot(note)
        note.content = history.content
        note.save(update_fields=["content", "updated_at"])

    cleanup_note_history(note)
    histories = recent_history_queryset(note)[:MAX_NOTE_HISTORY]
    payload = note_payload(note, changed=True)
    payload["history"] = [history_payload(item) for item in histories]
    return Response(payload)
