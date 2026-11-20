# Kilo

Bloco de notas pessoal minimalista com armazenamento comprimido em **Oracle Database** (`oracledb` Thin Mode), edição rich-text, temas claro/escuro, suporte multi-usuário com painel administrativo e exportação para PNG.

## Recursos

- **Armazenamento comprimido e leitura integral (100% lossless):**
  - Texto HTML comprimido no banco com `zlib` (nível 9) e descomprimido por completo ao abrir a nota.
  - Imagens coladas com `Ctrl+V` armazenadas em resolução e fidelidade originais (**WebP Lossless** ou formato original + camada `zlib` quando reduz mais), sem perda de nitidez.
- **Multi-usuário & Painel Admin:**
  - Cadastro de contas (`/register`) com nome de usuário, e-mail e senha.
  - Isolamento estrito de notas por usuário e área `/admin` exclusiva para listar usuários em blocos e inspecionar suas notas descomprimidas.
- **Editor minimalista:**
  - Barra de formatação (negrito, itálico, sublinhado, tamanho da fonte, cor do texto, cor de fundo e limpar formatação).
  - Tema claro e escuro com alternância instantânea e persistência em `localStorage`.
  - Exportação direta da nota (texto formatado + imagens) para **PNG**.

## Execução Local

1. Crie o schema no Oracle usando [sql/schema.sql](sql/schema.sql) (ou [sql/migration_v2.sql](sql/migration_v2.sql) se estiver atualizando da v1).
2. Copie `.env.example` para `.env` e configure suas credenciais Oracle e `ADMIN_PASSWORD_HASH`.
3. Instale dependências e execute:
   ```bash
   python -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   .venv\Scripts\python.exe wsgi.py
   ```
4. Para recompilar os módulos TypeScript após alterações em `static/ts/`:
   ```bash
   npm install
   npm run build
   ```
