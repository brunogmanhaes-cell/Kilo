export function initEditorToolbar(options) {
    const { editor, onContentChange } = options;
    const cmdButtons = Array.from(document.querySelectorAll("#editor-toolbar [data-cmd]"));
    const selectFontSize = document.getElementById("select-font-size");
    const btnTextColor = document.getElementById("btn-text-color");
    const popoverTextColor = document.getElementById("popover-text-color");
    const textColorBar = document.getElementById("text-color-bar");
    const inputTextColor = document.getElementById("input-text-color");
    const btnResetTextColor = document.getElementById("btn-reset-text-color");
    const btnBgColor = document.getElementById("btn-bg-color");
    const popoverBgColor = document.getElementById("popover-bg-color");
    const bgColorBar = document.getElementById("bg-color-bar");
    const inputBgColor = document.getElementById("input-bg-color");
    const btnResetBgColor = document.getElementById("btn-reset-bg-color");
    const btnClearFormat = document.getElementById("btn-clear-format");
    let lastEditorRange = null;
    const captureRange = () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
            lastEditorRange = range.cloneRange();
        }
    };
    document.addEventListener("selectionchange", captureRange);
    editor.addEventListener("mouseup", captureRange);
    editor.addEventListener("keyup", captureRange);
    const restoreRange = () => {
        editor.focus();
        const selection = window.getSelection();
        if (!selection) {
            return null;
        }
        if (lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer)) {
            selection.removeAllRanges();
            selection.addRange(lastEditorRange);
            return lastEditorRange;
        }
        if (selection.rangeCount > 0) {
            const current = selection.getRangeAt(0);
            if (editor.contains(current.commonAncestorContainer)) {
                return current;
            }
        }
        return null;
    };
    const applyInlineStyle = (prop, value) => {
        const range = restoreRange();
        if (!range) {
            return;
        }
        const span = document.createElement("span");
        span.style[prop] = value;
        if (range.collapsed) {
            const marker = document.createTextNode("\u200B");
            span.appendChild(marker);
            range.insertNode(span);
            const caret = document.createRange();
            caret.setStart(marker, 1);
            caret.collapse(true);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(caret);
            }
            lastEditorRange = caret.cloneRange();
        }
        else {
            const fragment = range.extractContents();
            fragment.querySelectorAll("span").forEach((child) => {
                if (child instanceof HTMLElement) {
                    child.style[prop] = "";
                }
            });
            span.appendChild(fragment);
            range.insertNode(span);
            const nextRange = document.createRange();
            nextRange.selectNodeContents(span);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(nextRange);
            }
            lastEditorRange = nextRange.cloneRange();
        }
        onContentChange();
    };
    const closePopovers = () => {
        popoverTextColor.classList.add("hidden");
        popoverBgColor.classList.add("hidden");
    };
    for (const btn of cmdButtons) {
        btn.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
        btn.addEventListener("click", () => {
            const cmd = btn.dataset.cmd;
            if (!cmd) {
                return;
            }
            restoreRange();
            document.execCommand(cmd, false);
            captureRange();
            onContentChange();
        });
    }
    selectFontSize.addEventListener("change", () => {
        const size = selectFontSize.value;
        if (size) {
            applyInlineStyle("fontSize", size);
            selectFontSize.value = "";
        }
    });
    btnTextColor.addEventListener("mousedown", (event) => event.preventDefault());
    btnTextColor.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasHidden = popoverTextColor.classList.contains("hidden");
        closePopovers();
        if (wasHidden) {
            popoverTextColor.classList.remove("hidden");
        }
    });
    btnBgColor.addEventListener("mousedown", (event) => event.preventDefault());
    btnBgColor.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasHidden = popoverBgColor.classList.contains("hidden");
        closePopovers();
        if (wasHidden) {
            popoverBgColor.classList.remove("hidden");
        }
    });
    popoverTextColor.querySelectorAll("[data-text-color]").forEach((swatch) => {
        swatch.addEventListener("mousedown", (event) => event.preventDefault());
        swatch.addEventListener("click", () => {
            const color = swatch.dataset.textColor;
            if (!color) {
                return;
            }
            textColorBar.style.background = color;
            applyInlineStyle("color", color);
            closePopovers();
        });
    });
    inputTextColor.addEventListener("input", () => {
        textColorBar.style.background = inputTextColor.value;
        applyInlineStyle("color", inputTextColor.value);
    });
    btnResetTextColor.addEventListener("click", () => {
        textColorBar.style.background = "var(--text)";
        applyInlineStyle("color", "inherit");
        closePopovers();
    });
    popoverBgColor.querySelectorAll("[data-bg-color]").forEach((swatch) => {
        swatch.addEventListener("mousedown", (event) => event.preventDefault());
        swatch.addEventListener("click", () => {
            const bg = swatch.dataset.bgColor;
            if (!bg) {
                return;
            }
            bgColorBar.style.background = bg;
            applyInlineStyle("backgroundColor", bg);
            closePopovers();
        });
    });
    inputBgColor.addEventListener("input", () => {
        bgColorBar.style.background = inputBgColor.value;
        applyInlineStyle("backgroundColor", inputBgColor.value);
    });
    btnResetBgColor.addEventListener("click", () => {
        bgColorBar.style.background = "transparent";
        applyInlineStyle("backgroundColor", "transparent");
        closePopovers();
    });
    btnClearFormat.addEventListener("mousedown", (event) => event.preventDefault());
    btnClearFormat.addEventListener("click", () => {
        const range = restoreRange();
        if (!range) {
            return;
        }
        document.execCommand("removeFormat", false);
        if (!range.collapsed) {
            const fragment = range.extractContents();
            fragment.querySelectorAll("span").forEach((el) => {
                if (el instanceof HTMLElement) {
                    el.removeAttribute("style");
                }
            });
            range.insertNode(fragment);
        }
        captureRange();
        onContentChange();
    });
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (target &&
            !popoverTextColor.contains(target) &&
            !btnTextColor.contains(target) &&
            !popoverBgColor.contains(target) &&
            !btnBgColor.contains(target)) {
            closePopovers();
        }
    });
    return {
        setEnabled(enabled) {
            for (const btn of cmdButtons) {
                btn.disabled = !enabled;
            }
            selectFontSize.disabled = !enabled;
            btnTextColor.disabled = !enabled;
            btnBgColor.disabled = !enabled;
            btnClearFormat.disabled = !enabled;
            if (!enabled) {
                closePopovers();
            }
        },
    };
}
