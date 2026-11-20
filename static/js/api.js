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
export function createNote(title = "Sem título", content = "") {
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
export function listAdminUsers() {
    return requestJson("/api/admin/users");
}
export function listAdminUserNotes(userId) {
    return requestJson(`/api/admin/users/${userId}/notes`);
}
export function getAdminNote(noteId) {
    return requestJson(`/api/admin/notes/${noteId}`);
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
export function formatCompactSavings(metrics) {
    if (metrics.raw_bytes <= 0) {
        return "0 B";
    }
    return `${formatBytes(metrics.raw_bytes)} → ${formatBytes(metrics.compressed_bytes)} · -${metrics.saved_percent.toFixed(1)}%`;
}
