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

from .models import Note, NoteHistory

SLUG_ALPHABET = string.ascii_lowercase + string.digits
SLUG_LENGTH = 8
MAX_SLUG_ATTEMPTS = 10
LARGE_FILE_BYTES = 5 * 1024 * 1024
LARGE_FILE_LIFETIME = timedelta(hours=3)
MAX_NOTE_LINES = 2000
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


def locked_response():
    return JsonResponse({"error": "This note is locked.", "locked": True}, status=423)


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
    }


def history_cutoff():
    return timezone.now() - NOTE_HISTORY_LIFETIME


def recent_history_queryset(note):
    return note.history.filter(created_at__gte=history_cutoff())


def cleanup_note_history(note):
    note.history.filter(created_at__lt=history_cutoff()).delete()
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


def count_note_lines(content):
    return content.count("\n") + 1 if content else 0


def create_note():
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
        "has_password": bool(note.password),
    }
    if changed is not None:
        payload["changed"] = changed
    return payload


def home(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    ensure_static_notes()
    note = create_note()
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


@require_http_methods(["GET", "POST"])
def note_api(request, slug):
    note = get_note_for_slug(slug)
    remove_expired_attachment(note)

    if not is_note_unlocked(request, note):
        return locked_response()

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

    if count_note_lines(content) > MAX_NOTE_LINES:
        return JsonResponse(
            {"error": f"Content cannot be more than {MAX_NOTE_LINES} lines."},
            status=400,
        )

    changed = content != note.content
    if changed:
        create_history_snapshot(note)
        note.content = content
        note.save(update_fields=["content", "updated_at"])

    return JsonResponse(note_payload(note, changed=changed))


@require_http_methods(["POST", "DELETE"])
def note_file(request, slug):
    with transaction.atomic():
        if slug in STATIC_NOTE_SLUGS:
            Note.objects.get_or_create(slug=slug)
        note = get_object_or_404(Note.objects.select_for_update(), slug=slug)
        remove_expired_attachment(note)
        if not is_note_unlocked(request, note):
            return locked_response()

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
    note = get_note_for_slug(slug)
    remove_expired_attachment(note)
    if not is_note_unlocked(request, note):
        return locked_response()
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


@require_http_methods(["POST"])
def note_unlock(request, slug):
    note = get_note_for_slug(slug)
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str):
        return JsonResponse({"error": "Password must be a string."}, status=400)

    if not note.password or password == note.password:
        request.session[unlock_session_key(note)] = True
        request.session.modified = True
        remove_expired_attachment(note)
        return JsonResponse(note_payload(note))

    return JsonResponse({"error": "Wrong password."}, status=403)


@require_http_methods(["POST", "DELETE"])
def note_password(request, slug):
    note = get_note_for_slug(slug)
    if not is_note_unlocked(request, note):
        return locked_response()

    if request.method == "DELETE":
        note.password = ""
        note.save(update_fields=["password", "updated_at"])
        request.session.pop(unlock_session_key(note), None)
        request.session.modified = True
        return JsonResponse({"has_password": False})

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str):
        return JsonResponse({"error": "Password must be a string."}, status=400)

    password = password.strip()
    if not password:
        return JsonResponse({"error": "Enter a password."}, status=400)

    note.password = password[:128]
    note.save(update_fields=["password", "updated_at"])
    request.session[unlock_session_key(note)] = True
    request.session.modified = True
    return JsonResponse({"has_password": True})


@require_http_methods(["GET", "POST"])
def note_history(request, slug):
    note = get_note_for_slug(slug)
    if not is_note_unlocked(request, note):
        return locked_response()

    if request.method == "GET":
        cleanup_note_history(note)
        histories = recent_history_queryset(note)[:MAX_NOTE_HISTORY]
        return JsonResponse({"history": [history_payload(item) for item in histories]})

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    history_id = payload.get("history_id") if isinstance(payload, dict) else None
    cleanup_note_history(note)
    history = get_object_or_404(
        NoteHistory,
        id=history_id,
        note=note,
        created_at__gte=history_cutoff(),
    )
    if history.content != note.content:
        create_history_snapshot(note)
        note.content = history.content
        note.save(update_fields=["content", "updated_at"])

    cleanup_note_history(note)
    histories = recent_history_queryset(note)[:MAX_NOTE_HISTORY]
    payload = note_payload(note, changed=True)
    payload["history"] = [history_payload(item) for item in histories]
    return JsonResponse(payload)
