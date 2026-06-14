from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("api/<str:slug>/", views.note_api, name="note_api"),
    path("api/<str:slug>/file/", views.note_file, name="note_file"),
    path(
        "api/<str:slug>/file/download/",
        views.download_note_file,
        name="download_note_file",
    ),
    path("<str:slug>/", views.note_add.detail, name="note_detail"),
]
