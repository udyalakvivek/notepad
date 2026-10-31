from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("myapp", "0003_note_password_notehistory")]

    operations = [
        migrations.AddField(
            model_name="note",
            name="title",
            field=models.CharField(blank=True, max_length=120),
        ),
    ]
