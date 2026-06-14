# Personal Paste

A small no-login Django notepad/pastebin. Opening `/` creates a note with a
cryptographically random URL. Anyone with that URL can read and edit the note,
and changed content is saved automatically once per second.

This implementation keeps the existing Django project package (`notepad`) and
application (`myapp`).

## Local setup

```bash
python -m venv notevenv
source notevenv/bin/activate
pip install django
python manage.py migrate
python manage.py runserver
```

Open <http://127.0.0.1:8000/>.

## MySQL production configuration

Install a compatible MySQL driver such as `mysqlclient`, create the database,
and set these environment variables:

```bash
export DB_ENGINE=mysql
export DB_NAME=personal_paste
export DB_USER=your_user
export DB_PASSWORD=your_password
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DJANGO_SECRET_KEY=replace-with-a-secure-secret
export DJANGO_DEBUG=False
export DJANGO_ALLOWED_HOSTS=paste.example.com
```

Then run:

```bash
python manage.py migrate
python manage.py collectstatic
```

Serve Django with a production WSGI/ASGI server and HTTPS.

## Routes

- `/` creates a new note and redirects to it
- `/<slug>/` opens the note editor, for example `/xqj25ft9/`
- `/api/<slug>/` returns the latest content with `GET` and saves with `POST`
- `/api/<slug>/file/` uploads or deletes the note's single attachment
- `/api/<slug>/file/download/` downloads the attachment

The API keeps Django's CSRF protection enabled. The browser only sends a save
request when editor content differs from the last successful save, and the
server also avoids updating unchanged content. The editor includes light and
dark themes, URL/text copy buttons, live word and character counts, and
automatic remote-content polling. Only one attachment is shown at a time; it
must be deleted before another can be uploaded. Files larger than 5 MB expire
three hours after upload and are removed by the page/API polling cleanup.
