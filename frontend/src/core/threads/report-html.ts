/**
 * Convert a markdown report into a self-contained HTML page styled for
 * industry research reports.  Used by the artifact viewer's "Export as
 * HTML" action.
 */
import { marked } from "marked";

import { getBackendBaseURL } from "../config";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const REPORT_CSS = `
  :root {
    --ink: #0b1e33;
    --ink-soft: #324b6b;
    --muted: #5d738f;
    --line: #d8e1ec;
    --bg: #f6f8fb;
    --surface: #ffffff;
    --accent: #1d4f91;
    --accent-soft: #e6efff;
    --code-bg: #0b1e33;
    --code-fg: #e6efff;
    --max: 880px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    line-height: 1.75;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
  }
  .report-shell {
    max-width: var(--max);
    margin: 0 auto;
    padding: 64px 32px 96px;
  }
  header.report-cover {
    border-left: 6px solid var(--accent);
    padding: 8px 0 24px 24px;
    margin-bottom: 48px;
  }
  header.report-cover .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
  }
  header.report-cover h1 {
    margin: 12px 0 16px;
    font-size: 36px;
    line-height: 1.25;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  header.report-cover .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    color: var(--muted);
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  header.report-cover .meta strong { color: var(--ink-soft); }
  article.report-body {
    background: var(--surface);
    padding: 56px 56px 64px;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(11, 30, 51, 0.04), 0 8px 32px rgba(11, 30, 51, 0.06);
  }
  article.report-body h1, article.report-body h2, article.report-body h3, article.report-body h4 {
    color: var(--ink);
    margin: 2.2em 0 0.6em;
    line-height: 1.35;
  }
  article.report-body h1 { font-size: 28px; border-bottom: 2px solid var(--accent); padding-bottom: 12px; }
  article.report-body h2 { font-size: 22px; }
  article.report-body h2::before {
    content: "";
    display: inline-block;
    width: 4px;
    height: 18px;
    background: var(--accent);
    margin-right: 10px;
    vertical-align: -3px;
    border-radius: 2px;
  }
  article.report-body h3 { font-size: 18px; color: var(--ink-soft); }
  article.report-body p { margin: 0 0 1.1em; }
  article.report-body a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-soft); }
  article.report-body a:hover { border-bottom-color: var(--accent); }
  article.report-body ul, article.report-body ol { padding-left: 1.4em; margin: 0 0 1.1em; }
  article.report-body li { margin-bottom: 0.4em; }
  article.report-body blockquote {
    border-left: 4px solid var(--accent);
    background: var(--accent-soft);
    margin: 1.4em 0;
    padding: 12px 20px;
    color: var(--ink-soft);
    border-radius: 4px;
  }
  article.report-body code {
    font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    background: rgba(11, 30, 51, 0.06);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    color: var(--accent);
  }
  article.report-body pre {
    background: var(--code-bg);
    color: var(--code-fg);
    padding: 18px 20px;
    border-radius: 6px;
    overflow-x: auto;
    line-height: 1.55;
    font-size: 13.5px;
  }
  article.report-body pre code {
    background: transparent;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  article.report-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 1.4em 0;
    font-size: 14px;
  }
  article.report-body th, article.report-body td {
    border: 1px solid var(--line);
    padding: 10px 14px;
    text-align: left;
  }
  article.report-body th { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
  article.report-body tr:nth-child(2n) td { background: #fafbfd; }
  article.report-body img { max-width: 100%; border-radius: 6px; }
  article.report-body hr { border: 0; border-top: 1px solid var(--line); margin: 2.4em 0; }
  footer.report-footer {
    margin-top: 56px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 12.5px;
    letter-spacing: 0.04em;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  /* Floating ToC built from headings */
  nav.report-toc {
    position: fixed;
    top: 32px;
    right: 32px;
    width: 240px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 18px;
    font-size: 13px;
    box-shadow: 0 1px 3px rgba(11, 30, 51, 0.04);
  }
  nav.report-toc strong {
    display: block;
    color: var(--accent);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    margin-bottom: 10px;
  }
  nav.report-toc ol { list-style: none; padding: 0; margin: 0; }
  nav.report-toc li { margin: 6px 0; }
  nav.report-toc li.lvl-3 { padding-left: 14px; font-size: 12px; color: var(--ink-soft); }
  nav.report-toc a { color: var(--ink-soft); text-decoration: none; }
  nav.report-toc a:hover { color: var(--accent); }
  @media (max-width: 1180px) { nav.report-toc { display: none; } }
  @media (max-width: 720px) {
    .report-shell { padding: 32px 16px 64px; }
    article.report-body { padding: 32px 22px; }
    header.report-cover h1 { font-size: 28px; }
  }
  @media print {
    body { background: white; }
    nav.report-toc { display: none; }
    article.report-body { box-shadow: none; padding: 0; }
  }
`;

function renderBody(reportMarkdown: string): {
  body: string;
  toc: { level: number; text: string; id: string }[];
} {
  marked.setOptions({ gfm: true, breaks: false });
  const renderer = new marked.Renderer();
  const toc: { level: number; text: string; id: string }[] = [];
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[^\p{L}\p{N}\-_]/gu, "")
      .slice(0, 80) || `section-${toc.length + 1}`;

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((tok) => ("text" in tok ? tok.text : "")).join("");
    const id = slug(text);
    if (depth <= 3) toc.push({ level: depth, text, id });
    return `<h${depth} id="${id}">${escapeHtml(text)}</h${depth}>`;
  };

  const body = marked.parse(reportMarkdown, { renderer, async: false }) as string;
  return { body, toc };
}

export interface ReportHtmlMeta {
  title: string;
  threadId: string;
  filename?: string;
  locale?: "en-US" | "zh-CN";
}

const REPORT_LABELS = {
  "en-US": {
    htmlLang: "en",
    emptyContent: "_No content_",
    toc: "Table of Contents",
    eyebrow: "Industry Research Report",
    exportedAt: "Exported",
    sessionId: "Session ID",
    generator: "Generated by",
    footer: "This report was generated by Spark-Agent for reference only.",
  },
  "zh-CN": {
    htmlLang: "zh-CN",
    emptyContent: "_无内容_",
    toc: "目录",
    eyebrow: "Industry Research Report · 行业研究报告",
    exportedAt: "导出时间",
    sessionId: "会话 ID",
    generator: "生成者",
    footer: "本报告由 Spark-Agent 自动生成，仅供参考。",
  },
} as const;

/** Build a self-contained HTML document for the given markdown report. */
export function renderReportHtml(
  markdownContent: string,
  meta: ReportHtmlMeta,
): string {
  const labels = REPORT_LABELS[meta.locale ?? "en-US"] ?? REPORT_LABELS["en-US"];
  const { body, toc } = renderBody(markdownContent || labels.emptyContent);
  const tocHtml =
    toc.length > 1
      ? `<nav class="report-toc"><strong>${labels.toc}</strong><ol>${toc
          .map(
            (t) =>
              `<li class="lvl-${t.level}"><a href="#${t.id}">${escapeHtml(
                t.text,
              )}</a></li>`,
          )
          .join("")}</ol></nav>`
      : "";

  const exportedAt = new Date().toLocaleString();
  return `<!DOCTYPE html>
<html lang="${labels.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.title)}</title>
  <meta name="generator" content="Spark-Agent Report Export" />
  <style>${REPORT_CSS}</style>
</head>
<body>
  ${tocHtml}
  <div class="report-shell">
    <header class="report-cover">
      <div class="eyebrow">${labels.eyebrow}</div>
      <h1>${escapeHtml(meta.title)}</h1>
      <div class="meta">
        <span><strong>${labels.exportedAt}</strong> ${escapeHtml(exportedAt)}</span>
        <span><strong>${labels.sessionId}</strong> ${escapeHtml(meta.threadId.slice(0, 8))}</span>
        <span><strong>${labels.generator}</strong> Spark-Agent</span>
      </div>
    </header>
    <article class="report-body">${body}</article>
    <footer class="report-footer">
      <span>${labels.footer}</span>
      <span>Powered by Spark-Agent</span>
    </footer>
  </div>
</body>
</html>`;
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\p{L}\p{N}_\- ]/gu, "").trim() || "report";
}

/**
 * Convert markdown → styled HTML, trigger a local download, and POST
 * to the backend so the file lands in MinIO and the user gets a
 * shareable URL.  Returns the absolute share URL on success or ``null``
 * if upload failed (the local download still happens).
 */
export async function exportReportAsHtml(
  markdownContent: string,
  meta: ReportHtmlMeta,
): Promise<string | null> {
  const html = renderReportHtml(markdownContent, meta);
  const downloadName = `${sanitizeFilename(meta.filename ?? meta.title)}.html`;
  downloadBlob(html, downloadName, "text/html;charset=utf-8");

  try {
    const res = await fetch(
      `${getBackendBaseURL()}/api/threads/${encodeURIComponent(
        meta.threadId,
      )}/exports/html`,
      {
        method: "POST",
        headers: { "Content-Type": "text/html;charset=utf-8" },
        body: html,
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { share_url?: string };
    if (!data.share_url) return null;
    return new URL(data.share_url, window.location.origin).toString();
  } catch {
    return null;
  }
}
