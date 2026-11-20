import { formatBytes, formatCompactSavings, getAdminNote, listAdminUserNotes, listAdminUsers, } from "./api.js";
import { attachImageLightbox } from "./clipboard.js";
import { exportNoteToPng } from "./exportPng.js";
import { initThemeToggle } from "./theme.js";
const state = {
    users: [],
    selectedUserNotes: [],
    activeNote: null,
};
const elUsersView = document.getElementById("admin-users-view");
const elUsersGrid = document.getElementById("admin-users-grid");
const elSearchInput = document.getElementById("admin-search-input");
const elUserView = document.getElementById("admin-user-view");
const elBtnBackUsers = document.getElementById("btn-back-users");
const elBreadcrumbUser = document.getElementById("admin-breadcrumb-user");
const elBreadcrumbEmail = document.getElementById("admin-breadcrumb-email");
const elAdminNotesList = document.getElementById("admin-notes-list");
const elNoteEmpty = document.getElementById("admin-note-empty");
const elNoteView = document.getElementById("admin-note-view");
const elNoteTitle = document.getElementById("admin-note-title");
const elNoteDate = document.getElementById("admin-note-date");
const elNoteBody = document.getElementById("admin-note-body");
const elBtnExportPng = document.getElementById("btn-admin-export-png");
const elSavingsStat = document.getElementById("admin-savings-stat");
const elToastContainer = document.getElementById("toast-container");
function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = isError ? "toast error" : "toast";
    toast.textContent = message;
    elToastContainer.appendChild(toast);
    window.setTimeout(() => {
        toast.remove();
    }, 3600);
}
function formatDateLabel(isoDate) {
    if (!isoDate) {
        return "—";
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    return date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
function renderUsersGrid() {
    const query = elSearchInput.value.trim().toLowerCase();
    const filtered = query
        ? state.users.filter((u) => u.username.toLowerCase().includes(query) || u.email.toLowerCase().includes(query))
        : state.users;
    elUsersGrid.innerHTML = "";
    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notes-empty";
        empty.textContent = "Nenhum usuário encontrado.";
        elUsersGrid.appendChild(empty);
        return;
    }
    for (const user of filtered) {
        const block = document.createElement("button");
        block.type = "button";
        block.className = "user-block";
        const top = document.createElement("div");
        top.className = "user-block-top";
        const identity = document.createElement("div");
        const nameEl = document.createElement("div");
        nameEl.className = "user-block-name";
        nameEl.textContent = user.username;
        const emailEl = document.createElement("div");
        emailEl.className = "user-block-email";
        emailEl.textContent = user.email;
        identity.appendChild(nameEl);
        identity.appendChild(emailEl);
        top.appendChild(identity);
        if (user.is_admin) {
            const badge = document.createElement("span");
            badge.className = "admin-tag";
            badge.textContent = "Admin";
            top.appendChild(badge);
        }
        const stats = document.createElement("div");
        stats.className = "user-block-stats";
        const cells = [
            [String(user.note_count), "Notas"],
            [String(user.image_count), "Imagens"],
            [formatBytes(user.compressed_bytes), "Banco"],
        ];
        for (const [val, label] of cells) {
            const cell = document.createElement("div");
            cell.className = "stat-cell";
            const valEl = document.createElement("span");
            valEl.className = "stat-value";
            valEl.textContent = val;
            const lblEl = document.createElement("span");
            lblEl.className = "stat-label";
            lblEl.textContent = label;
            cell.appendChild(valEl);
            cell.appendChild(lblEl);
            stats.appendChild(cell);
        }
        block.appendChild(top);
        block.appendChild(stats);
        block.addEventListener("click", () => {
            void openUserWorkspace(user.id);
        });
        elUsersGrid.appendChild(block);
    }
}
function clearSelectedNote() {
    state.activeNote = null;
    elNoteEmpty.classList.remove("hidden");
    elNoteView.classList.add("hidden");
    elBtnExportPng.disabled = true;
    elSavingsStat.textContent = "";
}
function renderUserNotesList(activeId) {
    elAdminNotesList.innerHTML = "";
    if (state.selectedUserNotes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notes-empty";
        empty.textContent = "Este usuário não possui notas.";
        elAdminNotesList.appendChild(empty);
        return;
    }
    for (const note of state.selectedUserNotes) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = note.id === activeId ? "note-item active" : "note-item";
        const titleEl = document.createElement("div");
        titleEl.className = "note-item-title";
        titleEl.textContent = note.title || "Sem título";
        const dateEl = document.createElement("div");
        dateEl.className = "note-item-date";
        dateEl.textContent = formatDateLabel(note.updated_at);
        item.appendChild(titleEl);
        item.appendChild(dateEl);
        item.addEventListener("click", () => {
            void openAdminNote(note.id);
        });
        elAdminNotesList.appendChild(item);
    }
}
async function openUserWorkspace(userId) {
    try {
        const data = await listAdminUserNotes(userId);
        state.selectedUserNotes = data.notes;
        elBreadcrumbUser.textContent = data.user.username;
        elBreadcrumbEmail.textContent = data.user.email;
        elUsersView.classList.add("hidden");
        elUserView.classList.remove("hidden");
        clearSelectedNote();
        renderUserNotesList(null);
        if (data.notes.length > 0) {
            await openAdminNote(data.notes[0].id);
        }
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : "Erro ao abrir notas do usuário.", true);
    }
}
async function openAdminNote(noteId) {
    try {
        const detail = await getAdminNote(noteId);
        state.activeNote = detail;
        elNoteEmpty.classList.add("hidden");
        elNoteView.classList.remove("hidden");
        elBtnExportPng.disabled = false;
        elNoteTitle.textContent = detail.title || "Sem título";
        elNoteDate.textContent = `Atualizado em ${formatDateLabel(detail.updated_at)} · Autor: ${detail.owner.username}`;
        elNoteBody.innerHTML = detail.content;
        elSavingsStat.textContent = formatCompactSavings(detail.metrics);
        renderUserNotesList(detail.id);
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : "Erro ao carregar nota.", true);
    }
}
async function handleExportPng() {
    if (!state.activeNote) {
        return;
    }
    elBtnExportPng.disabled = true;
    try {
        await exportNoteToPng({
            title: state.activeNote.title,
            updatedAt: formatDateLabel(state.activeNote.updated_at),
            contentHtml: state.activeNote.content,
        });
        showToast("PNG exportado.");
    }
    catch (err) {
        showToast(err instanceof Error ? err.message : "Falha ao exportar PNG.", true);
    }
    finally {
        elBtnExportPng.disabled = state.activeNote === null;
    }
}
async function bootstrap() {
    initThemeToggle(document.getElementById("theme-toggle"));
    attachImageLightbox(elNoteBody);
    elSearchInput.addEventListener("input", renderUsersGrid);
    elBtnExportPng.addEventListener("click", () => {
        void handleExportPng();
    });
    elBtnBackUsers.addEventListener("click", () => {
        elUserView.classList.add("hidden");
        elUsersView.classList.remove("hidden");
        clearSelectedNote();
    });
    try {
        state.users = await listAdminUsers();
        renderUsersGrid();
    }
    catch (err) {
        elUsersGrid.innerHTML = '<div class="notes-empty">Erro ao carregar usuários.</div>';
        showToast(err instanceof Error ? err.message : "Falha ao carregar usuários.", true);
    }
}
void bootstrap();
