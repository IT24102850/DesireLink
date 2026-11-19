// API errors carry a stable code. The client translates `err.<CODE>`.
export class AppError extends Error {
  constructor(code, status = 400, extra) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (code, status = 400, extra) => {
  throw new AppError(code, status, extra);
};

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, ...(err.extra || {}) });
  }
  if (err?.name === "ZodError") {
    return res.status(400).json({ error: "VALIDATION", fields: err.issues.map((i) => i.path.join(".")) });
  }
  if (err?.name === "MulterError") {
    const code = err.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : err.code === "LIMIT_UNEXPECTED_FILE" ? "TOO_MANY_FILES" : "UPLOAD_FAILED";
    return res.status(400).json({ error: code });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "FILE_TOO_LARGE" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "VALIDATION" });
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: "SERVER_ERROR" });
}
