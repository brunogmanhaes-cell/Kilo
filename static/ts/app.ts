import {
  createNote,
  deleteNote,
  formatBytes,
  formatCompactSavings,
  getNote,
  listNotes,
  NoteDetail,
  NoteMetrics,
  NoteSummary,
  updateNote,
  UploadImageResponse,
} from "./api.js";
import { attachImageLightbox, attachPasteHandler } from "./clipboard.js";
import { EditorToolbarController, initEditorToolbar } from "./editorToolbar.js";
import { exportNoteToPng } from "./exportPng.js";
import { initThemeToggle } from "./theme.js";

const AUTOSAVE_DELAY_MS = 1000;

interface AppState {
  notes: NoteSummary[];
  activeNoteId: number | null;
  activeUpdatedAt: string;
  dirty: boolean;
  isSaving: boolean;
  autosaveTimer: number | null;
}

const state: AppState = {
  notes: [],
  activeNoteId: null,
  activeUpdatedAt: "",
  dirty: false,
  isSaving: false,
  autosaveTimer: null,
};

const elNotesList = document.getElementById("notes-list") as HTMLDivElement;
const elSearchInput = document.getElementById("search-input") as HTMLInputElement;
const elBtnNewNote = document.getElementById("btn-new-note") as HTMLButtonElement;
const elBtnEmptyNew = document.getElementById("btn-empty-new") as HTMLButtonElement;
const elEditorEmpty = document.getElementById("editor-empty") as HTMLDivElement;
const elEditorCanvas = document.getElementById("editor-canvas") as HTMLDivElement;
const elNoteTitle = document.getElementById("note-title") as HTMLInputElement;
const elNoteEditor = document.getElementById("note-editor") as HTMLDivElement;
const elBtnExportPng = document.getElementById("btn-export-png") as HTMLButtonElement;
const elBtnDelete = document.getElementById("btn-delete-note") as HTMLButtonElement;
const elSaveStatus = document.getElementById("save-status") as HTMLSpanElement;
const elSaveStatusText = document.getElementById("save-status-text") as HTMLSpanElement;
const elSavingsStat = document.getElementById("savings-stat") as HTMLSpanElement;
const elToastContainer = document.getElementById("toast-container") as HTMLDivElement;

let toolbar: EditorToolbarController;

function showToast(message: string, isError = false): void {
  const toast = document.createElement("div");
  toast.className = isError ? "toast error" : "toast";
  toast.textContent = message;
  elToastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function setSaveStatus(text: string, mode: "idle" | "saving" | "saved" | "error" = "idle"): void {
  elSaveStatusText.textContent = text;
  elSaveStatus.className = mode === "idle" ? "status-indicator" : `status-indicator ${mode}`;
}

function formatDateLabel(isoDate: string): string {
  if (!isoDate) {
    return "";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateSavingsDisplay(metrics: NoteMetrics | null): void {
  if (!metrics || metrics.raw_bytes <= 0) {
    elSavingsStat.textContent = "";
    elSavingsStat.title = "";
    return;
  }

  elSavingsStat.textContent = formatCompactSavings(metrics);
  elSavingsStat.title = [
    `Texto: ${formatBytes(metrics.raw_text_bytes)} → ${formatBytes(metrics.compressed_text_bytes)}`,
    `Imagens (${metrics.image_count}): ${formatBytes(metrics.raw_image_bytes)} → ${formatBytes(metrics.compressed_image_bytes)}`,
  ].join(" | ");
}

function setEditorEnabled(enabled: boolean): void {
  elBtnExportPng.disabled = !enabled;
  elBtnDelete.disabled = !enabled;
  toolbar.setEnabled(enabled);

  if (enabled) {
    elEditorEmpty.classList.add("hidden");
    elEditorCanvas.classList.remove("hidden");
  } else {
    elEditorEmpty.classList.remove("hidden");
    elEditorCanvas.classList.add("hidden");
    elNoteTitle.value = "";
    elNoteEditor.innerHTML = "";
    state.activeUpdatedAt = "";
    updateSavingsDisplay(null);
    setSaveStatus("Pronto");
  }
}

function renderNotesList(): void {
  const query = elSearchInput.value.trim().toLowerCase();
  const filtered = query
    ? state.notes.filter((note) => note.title.toLowerCase().includes(query))
    : state.notes;

  elNotesList.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "notes-empty";
    empty.textContent = query ? "Nenhum resultado." : "Nenhuma nota ainda.";
    elNotesList.appendChild(empty);
    return;
  }

  for (const note of filtered) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = note.id === state.activeNoteId ? "note-item active" : "note-item";

    const titleEl = document.createElement("div");
    titleEl.className = "note-item-title";
    titleEl.textContent = note.title || "Sem título";

    const dateEl = document.createElement("div");
    dateEl.className = "note-item-date";
    dateEl.textContent = formatDateLabel(note.updated_at);

    item.appendChild(titleEl);
    item.appendChild(dateEl);
    item.addEventListener("click", () => {
      void selectNote(note.id);
    });

    elNotesList.appendChild(item);
  }
}

function getCleanEditorHtml(): string {
  const clone = elNoteEditor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".paste-placeholder").forEach((el) => el.remove());
  return clone.innerHTML;
}

function applyNoteDetail(detail: NoteDetail): void {
  state.activeNoteId = detail.id;
  state.activeUpdatedAt = detail.updated_at;
  state.dirty = false;
  setEditorEnabled(true);
  elNoteTitle.value = detail.title;
  elNoteEditor.innerHTML = detail.content;
  updateSavingsDisplay(detail.metrics);
  setSaveStatus("Salvo", "saved");
  renderNotesList();
}

function upsertNoteSummary(summary: NoteSummary): void {
  const idx = state.notes.findIndex((n) => n.id === summary.id);
  if (idx >= 0) {
    state.notes.splice(idx, 1);
  }
  state.notes.unshift(summary);
  renderNotesList();
}

async function selectNote(noteId: number): Promise<void> {
  if (state.activeNoteId === noteId) {
    return;
  }

  if (state.dirty && state.activeNoteId !== null) {
    await saveActiveNote();
  }

  try {
    setSaveStatus("Abrindo…", "saving");
    const detail = await getNote(noteId);
    applyNoteDetail(detail);
  } catch (err) {
    setSaveStatus("Erro ao abrir", "error");
    showToast(err instanceof Error ? err.message : "Erro ao abrir nota.", true);
  }
}

async function handleCreateNote(): Promise<number> {
  if (state.dirty && state.activeNoteId !== null) {
    await saveActiveNote();
  }

  const created = await createNote("Sem título", "");
  upsertNoteSummary({
    id: created.id,
    title: created.title,
    updated_at: created.updated_at,
    metrics: created.metrics,
  });
  applyNoteDetail(created);
  elNoteTitle.focus();
  elNoteTitle.select();
  return created.id;
}

async function saveActiveNote(): Promise<void> {
  if (state.activeNoteId === null || state.isSaving) {
    return;
  }

  if (state.autosaveTimer !== null) {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }

  const noteId = state.activeNoteId;
  const title = elNoteTitle.value.trim() || "Sem título";
  const content = getCleanEditorHtml();

  state.isSaving = true;
  setSaveStatus("Salvando…", "saving");

  try {
    const updated = await updateNote(noteId, title, content);
    state.dirty = false;
    state.activeUpdatedAt = updated.updated_at;
    updateSavingsDisplay(updated.metrics);
    upsertNoteSummary({
      id: updated.id,
      title: updated.title,
      updated_at: updated.updated_at,
      metrics: updated.metrics,
    });
    setSaveStatus("Salvo", "saved");
  } catch (err) {
    setSaveStatus("Erro ao salvar", "error");
    showToast(err instanceof Error ? err.message : "Erro ao salvar nota.", true);
  } finally {
    state.isSaving = false;
  }
}

function scheduleAutosave(): void {
  if (state.activeNoteId === null) {
    return;
  }
  state.dirty = true;
  setSaveStatus("Editando…");

  if (state.autosaveTimer !== null) {
    window.clearTimeout(state.autosaveTimer);
  }
  state.autosaveTimer = window.setTimeout(() => {
    void saveActiveNote();
  }, AUTOSAVE_DELAY_MS);
}

async function handleDeleteActiveNote(): Promise<void> {
  if (state.activeNoteId === null) {
    return;
  }

  const noteId = state.activeNoteId;
  if (!window.confirm("Excluir esta nota e todas as suas imagens permanentemente?")) {
    return;
  }

  if (state.autosaveTimer !== null) {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }

  try {
    await deleteNote(noteId);
    state.notes = state.notes.filter((n) => n.id !== noteId);
    state.activeNoteId = null;
    state.dirty = false;

    if (state.notes.length > 0) {
      renderNotesList();
      await selectNote(state.notes[0].id);
    } else {
      setEditorEnabled(false);
      renderNotesList();
    }
    showToast("Nota excluída.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Erro ao excluir nota.", true);
  }
}

async function handleExportPng(): Promise<void> {
  if (state.activeNoteId === null) {
    return;
  }
  elBtnExportPng.disabled = true;
  try {
    await exportNoteToPng({
      title: elNoteTitle.value.trim() || "Sem título",
      updatedAt: formatDateLabel(state.activeUpdatedAt),
      contentHtml: getCleanEditorHtml(),
    });
    showToast("PNG exportado.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Falha ao exportar PNG.", true);
  } finally {
    elBtnExportPng.disabled = state.activeNoteId === null;
  }
}

async function ensureActiveNoteId(): Promise<number> {
  if (state.activeNoteId !== null) {
    return state.activeNoteId;
  }
  return handleCreateNote();
}

async function bootstrap(): Promise<void> {
  initThemeToggle(document.getElementById("theme-toggle"));
  toolbar = initEditorToolbar({
    editor: elNoteEditor,
    onContentChange: scheduleAutosave,
  });
  attachImageLightbox(elNoteEditor);

  elBtnNewNote.addEventListener("click", () => {
    void handleCreateNote().catch((err) => {
      showToast(err instanceof Error ? err.message : "Erro ao criar nota.", true);
    });
  });

  elBtnEmptyNew.addEventListener("click", () => {
    void handleCreateNote().catch((err) => {
      showToast(err instanceof Error ? err.message : "Erro ao criar nota.", true);
    });
  });

  elBtnExportPng.addEventListener("click", () => {
    void handleExportPng();
  });

  elBtnDelete.addEventListener("click", () => {
    void handleDeleteActiveNote();
  });

  elSearchInput.addEventListener("input", renderNotesList);
  elNoteTitle.addEventListener("input", scheduleAutosave);
  elNoteEditor.addEventListener("input", scheduleAutosave);

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveActiveNote();
    }
  });

  attachPasteHandler({
    editor: elNoteEditor,
    ensureNoteId: ensureActiveNoteId,
    onUploadStart: () => {
      setSaveStatus("Enviando imagem…", "saving");
    },
    onImageUploaded: (result: UploadImageResponse) => {
      const msg = `Imagem adicionada · ${formatBytes(result.raw_bytes)} → ${formatBytes(result.compressed_bytes)} (-${result.saved_percent.toFixed(1)}%)`;
      showToast(msg);
      state.dirty = true;
      void saveActiveNote();
    },
    onError: (message: string) => {
      setSaveStatus("Erro no upload", "error");
      showToast(message, true);
    },
  });

  try {
    const notes = await listNotes();
    state.notes = notes;
    renderNotesList();

    if (notes.length > 0) {
      await selectNote(notes[0].id);
    } else {
      setEditorEnabled(false);
    }
  } catch (err) {
    elNotesList.innerHTML = '<div class="notes-empty">Erro ao carregar notas.</div>';
    showToast(err instanceof Error ? err.message : "Falha de conexão.", true);
  }
}

void bootstrap();
