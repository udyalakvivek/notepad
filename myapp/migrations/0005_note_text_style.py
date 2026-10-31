from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("myapp", "0004_note_title")]

    operations = [
        migrations.AddField(
            model_name="note",
            name="text_color",
            field=models.CharField(default="default", max_length=7),
        ),
        migrations.AddField(
            model_name="note",
            name="text_weight",
            field=models.PositiveSmallIntegerField(default=400),
        ),
    ]
