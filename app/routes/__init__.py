from app.routes.admin_api import admin_api_bp
from app.routes.images_api import images_api_bp
from app.routes.notes_api import notes_api_bp
from app.routes.views import views_bp

__all__ = ["views_bp", "notes_api_bp", "images_api_bp", "admin_api_bp"]
