from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("api/<str:slug>/", views.note_api, name="note_api"),
    path("api/<str:slug>/unlock/", views.note_unlock, name="note_unlock"),
    path("api/<str:slug>/password/", views.note_password, name="note_password"),
    path("api/<str:slug>/history/", views.note_history, name="note_history"),
    path("api/<str:slug>/file/", views.note_file, name="note_file"),
    path(
        "api/<str:slug>/file/download/",
        views.download_note_file,
        name="download_note_file",
    ),
    path("<str:slug>/", views.note_detail, name="note_detail"),
]
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)