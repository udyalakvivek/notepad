from django.db import migrations, models

import myapp.models


class Migration(migrations.Migration):
    dependencies = [
        ("myapp", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="note",
            name="attachment",
            field=models.FileField(
                blank=True,
                upload_to=myapp.models.attachment_upload_path,
            ),
        ),
        migrations.AddField(
            model_name="note",
            name="attachment_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="note",
            name="attachment_size",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="note",
            name="attachment_uploaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
