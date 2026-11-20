async function requestJson(url, init) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...init,
    });
    if (response.status === 401) {
        window.location.href = "/login";
        throw new Error("Sessão expirada.");
    }
    if (response.status === 204) {
        return undefined;
    }
    const data = (await response.json().catch(() => ({})));
    if (!response.ok) {
        throw new Error(data.error || `Erro HTTP ${response.status}`);
    }
    return data;
}
export function listNotes() {
    return requestJson("/api/notes");
}
export function createNote(title = "Nova Nota", content = "") {
    return requestJson("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
    });
}
export function getNote(noteId) {
    return requestJson(`/api/notes/${noteId}`);
}
export function updateNote(noteId, title, content) {
    return requestJson(`/api/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
    });
}
export function deleteNote(noteId) {
    return requestJson(`/api/notes/${noteId}`, {
        method: "DELETE",
    });
}
export function uploadImage(noteId, file) {
    const formData = new FormData();
    formData.append("note_id", String(noteId));
    formData.append("image", file, file instanceof File ? file.name : "clipboard.png");
    return requestJson("/api/upload", {
        method: "POST",
        body: formData,
    });
}
export function formatBytes(bytes) {
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
export function formatSavingsBadge(metrics) {
    if (metrics.raw_bytes <= 0) {
        return "Original: 0 B → Salvo: 0 B (0%)";
    }
    const rawLabel = formatBytes(metrics.raw_bytes);
    const compLabel = formatBytes(metrics.compressed_bytes);
    return `Original: ${rawLabel} → Salvo: ${compLabel} (-${metrics.saved_percent.toFixed(1)}%)`;
}
