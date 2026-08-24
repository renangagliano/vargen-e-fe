import fs from "node:fs/promises";
import path from "node:path";
import type { EditorialPackage } from "../shared/types.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function writeLocalReviewPage(input: { outputDirectory: string; packages: Array<EditorialPackage & { video_filename: string; technical: Record<string, unknown> }>; }): Promise<string> {
  const cards = input.packages.map((item) => `
    <article class="card">
      <video controls preload="metadata" src="./${escapeHtml(item.video_filename)}"></video>
      <img src="./${escapeHtml(item.cover_filename)}" alt="Capa: ${escapeHtml(item.cover_text)}">
      <h2>${escapeHtml(item.editorial_title)}</h2>
      <p class="hook">${escapeHtml(item.selected_hook)}</p>
      <dl>
        <dt>Intenção</dt><dd>${escapeHtml(item.editorial_intent)}</dd>
        <dt>Bíblia</dt><dd>${escapeHtml(item.bible_reference)}</dd>
        <dt>CTA</dt><dd>${escapeHtml(item.cta)}</dd>
        <dt>Pilar</dt><dd>${escapeHtml(item.content_pillar)}${item.secondary_pillar ? ` / ${escapeHtml(item.secondary_pillar)}` : ""}</dd>
        <dt>Hashtags</dt><dd>${item.hashtags.map(escapeHtml).join(" ")}</dd>
        <dt>Status</dt><dd>${escapeHtml(item.review_status)} · ${escapeHtml(item.publication_status)}</dd>
      </dl>
      <pre>${escapeHtml(item.caption)}</pre>
    </article>`).join("\n");
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vargen &amp; Fé — Revisão Editorial</title>
<style>body{margin:0;background:#151311;color:#f5efe5;font:16px system-ui,sans-serif}header{padding:32px;max-width:1440px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;max-width:1440px;margin:auto;padding:0 32px 48px}.card{background:#29231d;border:1px solid #66543d;border-radius:12px;padding:16px}.card video,.card img{width:100%;aspect-ratio:9/16;object-fit:cover;background:#000;border-radius:8px}.card h2{font-size:21px}.hook{color:#e3b86a;font-size:18px}.card dl{display:grid;grid-template-columns:100px 1fr;gap:8px}.card dt{color:#bda47e;font-weight:700}.card dd{margin:0}.card pre{white-space:pre-wrap;font:14px/1.5 system-ui;color:#e4d9c9}</style></head>
<body><header><h1>Vargen &amp; Fé — Revisão Editorial</h1><p>Pacote Phase 4 · revisão humana obrigatória · publicação: NOT_PUBLISHED</p></header><main>${cards}</main></body></html>`;
  const outputPath = path.join(input.outputDirectory, "review.html");
  await fs.writeFile(outputPath, html, "utf8");
  return outputPath;
}
