import { uploadImage } from "./api.js";
function getEditorRange(editor) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const current = selection.getRangeAt(0);
        if (editor.contains(current.commonAncestorContainer)) {
            return current;
        }
    }
    const fallback = document.createRange();
    fallback.selectNodeContents(editor);
    fallback.collapse(false);
    return fallback;
}
function insertNodeAtRange(editor, range, node) {
    range.deleteContents();
    range.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    const selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(after);
    }
    editor.focus();
}
function insertPlainText(editor, text) {
    const range = getEditorRange(editor);
    const textNode = document.createTextNode(text);
    insertNodeAtRange(editor, range, textNode);
}
function extractImageFiles(clipboardData) {
    const files = [];
    for (const item of Array.from(clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
                files.push(file);
            }
        }
    }
    if (files.length === 0 && clipboardData.files.length > 0) {
        for (const file of Array.from(clipboardData.files)) {
            if (file.type.startsWith("image/")) {
                files.push(file);
            }
        }
    }
    return files;
}
export function attachPasteHandler(options) {
    const { editor, ensureNoteId, onUploadStart, onImageUploaded, onError } = options;
    editor.addEventListener("paste", (event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
            return;
        }
        const imageFiles = extractImageFiles(clipboardData);
        if (imageFiles.length > 0) {
            event.preventDefault();
            void handleImagePaste(imageFiles);
            return;
        }
        const plainText = clipboardData.getData("text/plain");
        if (plainText) {
            event.preventDefault();
            insertPlainText(editor, plainText);
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
    async function handleImagePaste(files) {
        let noteId;
        try {
            noteId = await ensureNoteId();
        }
        catch (err) {
            onError(err instanceof Error ? err.message : "Erro ao preparar nota para upload.");
            return;
        }
        for (const file of files) {
            const placeholder = document.createElement("span");
            placeholder.className = "paste-placeholder";
            placeholder.setAttribute("contenteditable", "false");
            placeholder.textContent = "Enviando imagem em qualidade original…";
            const range = getEditorRange(editor);
            insertNodeAtRange(editor, range, placeholder);
            onUploadStart?.();
            try {
                const result = await uploadImage(noteId, file);
                const img = document.createElement("img");
                img.src = result.url;
                img.width = result.width;
                img.height = result.height;
                img.alt = "Imagem anexada";
                img.loading = "lazy";
                placeholder.replaceWith(img);
                const after = document.createRange();
                after.setStartAfter(img);
                after.collapse(true);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(after);
                }
                onImageUploaded(result);
            }
            catch (err) {
                placeholder.remove();
                onError(err instanceof Error ? err.message : "Falha ao enviar imagem.");
            }
        }
    }
}
export function attachImageLightbox(container) {
    const lightbox = document.getElementById("image-lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxMeta = document.getElementById("lightbox-meta");
    const lightboxClose = document.getElementById("lightbox-close");
    if (!lightbox || !lightboxImg || !lightboxMeta || !lightboxClose) {
        return;
    }
    const close = () => {
        lightbox.classList.add("hidden");
        lightboxImg.src = "";
    };
    container.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) {
            return;
        }
        lightboxImg.src = target.src;
        const w = target.naturalWidth || target.width;
        const h = target.naturalHeight || target.height;
        lightboxMeta.textContent = w && h ? `${w} × ${h} px (original)` : "Qualidade original";
        lightbox.classList.remove("hidden");
    });
    lightboxClose.addEventListener("click", close);
    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) {
            close();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !lightbox.classList.contains("hidden")) {
            close();
        }
    });
}
