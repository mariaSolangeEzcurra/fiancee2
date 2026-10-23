
from django.contrib.auth.models import AbstractUser
from django.db import models


class Usuario(AbstractUser):
    class Rol(models.TextChoices):
        COMERCIAL = "comercial", "Comercial"
        JEFA_TALLER = "jefa_taller", "Jefa de taller"
        TALLER = "taller", "Taller"
        GERENCIA = "gerencia", "Gerencia"

    rol = models.CharField(
        max_length=20,
        choices=Rol.choices,
        default=Rol.TALLER,
        verbose_name="Rol de usuario",
    )

    def __str__(self):
        return f"{self.username} - {self.get_rol_display()}"
