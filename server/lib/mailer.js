import nodemailer from "nodemailer";
import { config } from "../config.js";
import { emailText } from "./emailText.js";

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function layout(lang, heading, bodyLines, cta) {
  const font = lang === "si" ? "'Noto Sans Sinhala'," : lang === "ta" ? "'Noto Sans Tamil'," : "";
  const lines = bodyLines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#c8264d;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#120a0d;padding:24px;font-family:${font}Arial,sans-serif;color:#f4e9ec">
<div style="max-width:520px;margin:0 auto;background:#1d1116;border-radius:16px;padding:28px;border:1px solid #3a1f29">
<p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#ff6b6b">DesireLink</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>${lines}${button}
<p style="margin:24px 0 0;font-size:12px;color:#a88c95">${escapeHtml(emailText(lang).footer)}</p>
</div></body></html>`;
}

/**
 * Send a templated email.
 * kind: "code" | "reset" | "verificationApproved" | "verificationRejected" | "adApproved" | "adRejected" | "adRemoved"
 */
export async function sendMail(to, lang, kind, vars = {}) {
  const t = emailText(lang);
  const tpl = t[kind];
  const subject = tpl.subject;
  const lines = tpl.lines(vars);
  const cta = tpl.cta ? { label: tpl.cta, url: config.appUrl + (vars.path || "/") } : null;
  const text = [...lines, cta ? `${cta.label}: ${cta.url}` : "", "", t.footer].join("\n");

  if (globalThis.__mailSink) {
    globalThis.__mailSink.push({ to, lang, kind, vars, subject });
    return;
  }
  if (!transport) {
    console.log(`\n[mail:console] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, text, html: layout(lang, subject, lines, cta) });
  } catch (e) {
    // Notifications must never break the request that triggered them.
    console.error("[mail] send failed:", e.message);
    if (kind === "code" || kind === "reset") throw e;
  }
}
