export interface NoteSummaryMetrics {
  raw_bytes: number;
  compressed_bytes: number;
  saved_percent: number;
  image_count: number;
}

export interface NoteMetrics extends NoteSummaryMetrics {
  raw_text_bytes: number;
  compressed_text_bytes: number;
  raw_image_bytes: number;
  compressed_image_bytes: number;
}

export interface NoteSummary {
  id: number;
  title: string;
  updated_at: string;
  metrics: NoteSummaryMetrics;
}

export interface NoteDetail {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  metrics: NoteMetrics;
}

export interface UpdateNoteResponse {
  id: number;
  title: string;
  updated_at: string;
  metrics: NoteMetrics;
}

export interface UploadImageResponse {
  id: number;
  url: string;
  width: number;
  height: number;
  raw_bytes: number;
  compressed_bytes: number;
  saved_percent: number;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sessão expirada.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Erro HTTP ${response.status}`);
  }

  return data as T;
}

export function listNotes(): Promise<NoteSummary[]> {
  return requestJson<NoteSummary[]>("/api/notes");
}

export function createNote(title = "Nova Nota", content = ""): Promise<NoteDetail> {
  return requestJson<NoteDetail>("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
}

export function getNote(noteId: number): Promise<NoteDetail> {
  return requestJson<NoteDetail>(`/api/notes/${noteId}`);
}

export function updateNote(
  noteId: number,
  title: string,
  content: string
): Promise<UpdateNoteResponse> {
  return requestJson<UpdateNoteResponse>(`/api/notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
}

export function deleteNote(noteId: number): Promise<void> {
  return requestJson<void>(`/api/notes/${noteId}`, {
    method: "DELETE",
  });
}

export function uploadImage(noteId: number, file: File | Blob): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.append("note_id", String(noteId));
  formData.append("image", file, file instanceof File ? file.name : "clipboard.png");

  return requestJson<UploadImageResponse>("/api/upload", {
    method: "POST",
    body: formData,
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatSavingsBadge(metrics: NoteSummaryMetrics): string {
  if (metrics.raw_bytes <= 0) {
    return "Original: 0 B → Salvo: 0 B (0%)";
  }
  const rawLabel = formatBytes(metrics.raw_bytes);
  const compLabel = formatBytes(metrics.compressed_bytes);
  return `Original: ${rawLabel} → Salvo: ${compLabel} (-${metrics.saved_percent.toFixed(1)}%)`;
}
