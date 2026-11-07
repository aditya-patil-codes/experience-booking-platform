export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  details?: FieldError[];

  constructor(
    status: number,
    code: string,
    message: string,
    details?: FieldError[]
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = { method?: string; body?: unknown };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const hasBody = options.body !== undefined;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin"
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? "Request failed",
      err?.details
    );
  }

  return data as T;
}
