from flask import Flask, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from app.auth import login_manager
from app.config import Config
from app.db import init_db
from app.routes import admin_api_bp, images_api_bp, notes_api_bp, views_bp


def create_app(config_object: type[Config] = Config) -> Flask:
    """Application Factory do Kilo Notes."""
    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
    )
    app.config.from_object(config_object)

    login_manager.init_app(app)
    init_db(app)

    app.register_blueprint(views_bp)
    app.register_blueprint(notes_api_bp)
    app.register_blueprint(images_api_bp)
    app.register_blueprint(admin_api_bp)

    @app.errorhandler(RequestEntityTooLarge)
    def handle_file_too_large(_err: RequestEntityTooLarge):
        max_mb = round(app.config["MAX_CONTENT_LENGTH"] / (1024 * 1024), 1)
        return jsonify({"error": f"Arquivo excede o limite de {max_mb} MB."}), 413

    @app.errorhandler(500)
    def handle_internal_error(_err: Exception):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Erro interno no servidor."}), 500
        return "Erro interno no servidor.", 500

    return app
