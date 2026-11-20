import { getTheme } from "./theme.js";

export interface ExportPngOptions {
  title: string;
  updatedAt?: string;
  contentHtml: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Falha ao ler imagem para exportação."));
      }
    };
    reader.onerror = () => reject(new Error("Erro ao converter imagem."));
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) {
        return;
      }
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      img.setAttribute("src", dataUrl);
      img.removeAttribute("loading");
      img.style.display = "block";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.margin = "14px 0";
      img.style.borderRadius = "6px";
    })
  );
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${cleaned || "nota"}.png`;
}

function loadSvgImage(svgMarkup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível renderizar a nota como imagem."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  });
}

export async function exportNoteToPng(options: ExportPngOptions): Promise<void> {
  const isDark = getTheme() === "dark";
  const bg = isDark ? "#000000" : "#ffffff";
  const fg = isDark ? "#ffffff" : "#000000";
  const muted = "#737373";
  const border = isDark ? "#1f1f1f" : "#e5e5e5";
  const width = 820;

  const card = document.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
  card.setAttribute(
    "style",
    [
      `--text:${fg}`,
      `width:${width}px`,
      "box-sizing:border-box",
      "padding:44px 48px",
      `background:${bg}`,
      `color:${fg}`,
      'font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      "font-size:15px",
      "line-height:1.7",
      "white-space:pre-wrap",
      "word-break:break-word",
    ].join(";")
  );

  const heading = document.createElementNS("http://www.w3.org/1999/xhtml", "h1");
  heading.textContent = options.title || "Sem título";
  heading.setAttribute(
    "style",
    `margin:0 0 6px;font-size:28px;font-weight:700;letter-spacing:-0.03em;line-height:1.25;color:${fg};`
  );
  card.appendChild(heading);

  if (options.updatedAt) {
    const meta = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    meta.textContent = options.updatedAt;
    meta.setAttribute(
      "style",
      `margin:0 0 22px;padding-bottom:14px;border-bottom:1px solid ${border};font-size:12px;color:${muted};`
    );
    card.appendChild(meta);
  }

  const body = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  body.innerHTML = options.contentHtml || "";
  body.querySelectorAll(".paste-placeholder").forEach((el) => el.remove());
  body.querySelectorAll("img").forEach((img) => {
    img.style.border = `1px solid ${border}`;
  });
  card.appendChild(body);

  await inlineImages(body);

  const measureHost = document.createElement("div");
  measureHost.setAttribute(
    "style",
    `position:fixed;left:-99999px;top:0;width:${width}px;pointer-events:none;opacity:0;`
  );
  measureHost.appendChild(card);
  document.body.appendChild(measureHost);

  await Promise.all(
    Array.from(card.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          })
    )
  );

  const height = Math.max(220, Math.ceil(card.scrollHeight));
  measureHost.remove();

  const serializedCard = new XMLSerializer().serializeToString(card);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serializedCard}</foreignObject></svg>`;

  const renderedImg = await loadSvgImage(svgMarkup);
  const scale = height > 6000 ? 1 : 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contexto Canvas 2D indisponível.");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(renderedImg, 0, 0, width, height);

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Falha ao gerar arquivo PNG."));
      }
    }, "image/png");
  });

  const downloadUrl = URL.createObjectURL(pngBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = sanitizeFilename(options.title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
}
