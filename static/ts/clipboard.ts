import { uploadImage, UploadImageResponse } from "./api.js";

export interface PasteHandlerOptions {
  editor: HTMLElement;
  ensureNoteId: () => Promise<number>;
  onUploadStart?: () => void;
  onImageUploaded: (result: UploadImageResponse) => void;
  onError: (message: string) => void;
}

function getEditorRange(editor: HTMLElement): Range {
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

function insertNodeAtRange(editor: HTMLElement, range: Range, node: Node): void {
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

function insertPlainText(editor: HTMLElement, text: string): void {
  const range = getEditorRange(editor);
  const textNode = document.createTextNode(text);
  insertNodeAtRange(editor, range, textNode);
}

function extractImageFiles(clipboardData: DataTransfer): File[] {
  const files: File[] = [];

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

export function attachPasteHandler(options: PasteHandlerOptions): void {
  const { editor, ensureNoteId, onUploadStart, onImageUploaded, onError } = options;

  editor.addEventListener("paste", (event: ClipboardEvent) => {
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

  async function handleImagePaste(files: File[]): Promise<void> {
    let noteId: number;
    try {
      noteId = await ensureNoteId();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao preparar nota para upload.");
      return;
    }

    for (const file of files) {
      const placeholder = document.createElement("span");
      placeholder.className = "paste-placeholder";
      placeholder.setAttribute("contenteditable", "false");
      placeholder.textContent = "Comprimindo e enviando imagem…";

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
      } catch (err) {
        placeholder.remove();
        onError(err instanceof Error ? err.message : "Falha ao enviar imagem.");
      }
    }
  }
}
