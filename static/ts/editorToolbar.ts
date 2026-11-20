export interface EditorToolbarOptions {
  editor: HTMLElement;
  onContentChange: () => void;
}

export interface EditorToolbarController {
  setEnabled: (enabled: boolean) => void;
}

type InlineStyleProperty = "fontSize" | "color" | "backgroundColor";

export function initEditorToolbar(options: EditorToolbarOptions): EditorToolbarController {
  const { editor, onContentChange } = options;

  const cmdButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#editor-toolbar [data-cmd]")
  );
  const selectFontSize = document.getElementById("select-font-size") as HTMLSelectElement;
  const btnTextColor = document.getElementById("btn-text-color") as HTMLButtonElement;
  const popoverTextColor = document.getElementById("popover-text-color") as HTMLDivElement;
  const textColorBar = document.getElementById("text-color-bar") as HTMLSpanElement;
  const inputTextColor = document.getElementById("input-text-color") as HTMLInputElement;
  const btnAdaptiveTextColor = document.getElementById(
    "btn-adaptive-text-color"
  ) as HTMLButtonElement;

  const btnBgColor = document.getElementById("btn-bg-color") as HTMLButtonElement;
  const popoverBgColor = document.getElementById("popover-bg-color") as HTMLDivElement;
  const bgColorBar = document.getElementById("bg-color-bar") as HTMLSpanElement;
  const inputBgColor = document.getElementById("input-bg-color") as HTMLInputElement;
  const btnResetBgColor = document.getElementById("btn-reset-bg-color") as HTMLButtonElement;

  const btnClearFormat = document.getElementById("btn-clear-format") as HTMLButtonElement;

  let lastEditorRange: Range | null = null;

  const captureRange = (): void => {
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

  const restoreRange = (): Range | null => {
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

  const applyInlineStyle = (prop: InlineStyleProperty, value: string): void => {
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
    } else {
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

  const closePopovers = (): void => {
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

  const setAdaptiveIndicator = (active: boolean, fixedColor?: string): void => {
    if (active) {
      btnAdaptiveTextColor.classList.add("active");
      textColorBar.classList.add("adaptive");
      textColorBar.style.background = "";
      btnTextColor.setAttribute("title", "Cor do texto (Adaptativa)");
    } else {
      btnAdaptiveTextColor.classList.remove("active");
      textColorBar.classList.remove("adaptive");
      textColorBar.style.background = fixedColor || "var(--text)";
      btnTextColor.setAttribute("title", `Cor do texto (${fixedColor || ""})`);
    }
  };

  btnAdaptiveTextColor.addEventListener("mousedown", (event) => event.preventDefault());
  btnAdaptiveTextColor.addEventListener("click", () => {
    setAdaptiveIndicator(true);
    applyInlineStyle("color", "var(--text)");
    closePopovers();
  });

  popoverTextColor.querySelectorAll<HTMLButtonElement>("[data-text-color]").forEach((swatch) => {
    swatch.addEventListener("mousedown", (event) => event.preventDefault());
    swatch.addEventListener("click", () => {
      const color = swatch.dataset.textColor;
      if (!color) {
        return;
      }
      setAdaptiveIndicator(false, color);
      applyInlineStyle("color", color);
      closePopovers();
    });
  });

  inputTextColor.addEventListener("input", () => {
    setAdaptiveIndicator(false, inputTextColor.value);
    applyInlineStyle("color", inputTextColor.value);
  });

  popoverBgColor.querySelectorAll<HTMLButtonElement>("[data-bg-color]").forEach((swatch) => {
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
    setAdaptiveIndicator(true);
    onContentChange();
  });

  document.addEventListener("click", (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (
      target &&
      !popoverTextColor.contains(target) &&
      !btnTextColor.contains(target) &&
      !popoverBgColor.contains(target) &&
      !btnBgColor.contains(target)
    ) {
      closePopovers();
    }
  });

  return {
    setEnabled(enabled: boolean): void {
      for (const btn of cmdButtons) {
        btn.disabled = !enabled;
      }
      selectFontSize.disabled = !enabled;
      btnTextColor.disabled = !enabled;
      btnBgColor.disabled = !enabled;
      btnClearFormat.disabled = !enabled;
      if (!enabled) {
        closePopovers();
      } else {
        setAdaptiveIndicator(true);
      }
    },
  };
}
