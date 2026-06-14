import json
import re
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Note
from .views import LARGE_FILE_BYTES

TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class NoteViewsTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA_ROOT, ignore_errors=True)

    def test_home_creates_note_and_redirects(self):
        response = self.client.get(reverse("home"))

        note = Note.objects.get()
        self.assertRedirects(
            response,
            reverse("note_detail", kwargs={"slug": note.slug}),
            fetch_redirect_response=False,
        )
        self.assertRegex(note.slug, re.compile(r"^[a-z0-9]{8}$"))
        self.assertEqual(response.url, f"/{note.slug}/")

    @patch("myapp.views.secrets.choice")
    def test_slug_collision_is_retried(self, choice):
        Note.objects.create(slug="existing")
        choice.side_effect = list("existingnewslug1")

        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 302)
        self.assertTrue(Note.objects.filter(slug="newslug1").exists())

    def test_routes_do_not_contain_n_prefix(self):
        note = Note.objects.create(slug="xqj25ft9")

        self.assertEqual(
            reverse("note_detail", kwargs={"slug": note.slug}),
            "/xqj25ft9/",
        )
        self.assertEqual(
            reverse("note_api", kwargs={"slug": note.slug}),
            "/api/xqj25ft9/",
        )
        self.assertEqual(self.client.get("/n/xqj25ft9/").status_code, 404)

    def test_note_page_displays_saved_content(self):
        note = Note.objects.create(slug="sample", content="hello <world>")

        response = self.client.get(
            reverse("note_detail", kwargs={"slug": note.slug})
        )

        self.assertContains(response, "hello &lt;world&gt;")
        self.assertContains(response, reverse("note_api", kwargs={"slug": note.slug}))
        self.assertContains(response, reverse("note_file", kwargs={"slug": note.slug}))

    def test_api_get_returns_latest_content(self):
        note = Note.objects.create(slug="sample", content="first")
        note.content = "latest"
        note.save()

        response = self.client.get(reverse("note_api", kwargs={"slug": note.slug}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], "latest")

    def test_api_post_updates_content(self):
        note = Note.objects.create(slug="sample")

        response = self.client.post(
            reverse("note_api", kwargs={"slug": note.slug}),
            data=json.dumps({"content": "new content"}),
            content_type="application/json",
        )

        note.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["changed"])
        self.assertEqual(note.content, "new content")

    def test_api_post_does_not_write_unchanged_content(self):
        note = Note.objects.create(slug="sample", content="same")
        original_updated_at = note.updated_at

        response = self.client.post(
            reverse("note_api", kwargs={"slug": note.slug}),
            data=json.dumps({"content": "same"}),
            content_type="application/json",
        )

        note.refresh_from_db()
        self.assertFalse(response.json()["changed"])
        self.assertEqual(note.updated_at, original_updated_at)

    def test_api_rejects_invalid_content(self):
        note = Note.objects.create(slug="sample")

        response = self.client.post(
            reverse("note_api", kwargs={"slug": note.slug}),
            data=json.dumps({"content": 123}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    def test_api_rejects_non_object_json(self):
        note = Note.objects.create(slug="sample")

        response = self.client.post(
            reverse("note_api", kwargs={"slug": note.slug}),
            data=json.dumps(["not", "an", "object"]),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    def test_api_post_requires_csrf_token(self):
        note = Note.objects.create(slug="sample")
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.post(
            reverse("note_api", kwargs={"slug": note.slug}),
            data=json.dumps({"content": "blocked"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_file_can_be_uploaded_downloaded_and_deleted(self):
        note = Note.objects.create(slug="sample")
        file_url = reverse("note_file", kwargs={"slug": note.slug})

        upload_response = self.client.post(
            file_url,
            {"file": SimpleUploadedFile("hello.txt", b"hello world")},
        )

        self.assertEqual(upload_response.status_code, 201)
        note.refresh_from_db()
        self.assertEqual(note.attachment_name, "hello.txt")
        self.assertTrue(note.attachment)

        download_response = self.client.get(
            reverse("download_note_file", kwargs={"slug": note.slug})
        )
        self.assertEqual(download_response.status_code, 200)
        self.assertEqual(b"".join(download_response.streaming_content), b"hello world")

        delete_response = self.client.delete(file_url)
        self.assertEqual(delete_response.status_code, 200)
        note.refresh_from_db()
        self.assertFalse(note.attachment)

    def test_second_file_is_blocked_until_current_file_is_deleted(self):
        note = Note.objects.create(slug="sample")
        file_url = reverse("note_file", kwargs={"slug": note.slug})
        self.client.post(
            file_url,
            {"file": SimpleUploadedFile("first.txt", b"first")},
        )

        response = self.client.post(
            file_url,
            {"file": SimpleUploadedFile("second.txt", b"second")},
        )

        self.assertEqual(response.status_code, 409)
        note.refresh_from_db()
        self.assertEqual(note.attachment_name, "first.txt")

    def test_large_file_expires_after_three_hours(self):
        note = Note.objects.create(
            slug="sample",
            attachment=SimpleUploadedFile("large.bin", b"small fixture"),
            attachment_name="large.bin",
            attachment_size=LARGE_FILE_BYTES + 1,
            attachment_uploaded_at=timezone.now() - timedelta(hours=3, seconds=1),
        )

        response = self.client.get(reverse("note_api", kwargs={"slug": note.slug}))

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["attachment"])
        note.refresh_from_db()
        self.assertFalse(note.attachment)

    def test_file_upload_requires_csrf_token(self):
        note = Note.objects.create(slug="sample")
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.post(
            reverse("note_file", kwargs={"slug": note.slug}),
            {"file": SimpleUploadedFile("blocked.txt", b"blocked")},
        )

        self.assertEqual(response.status_code, 403)
