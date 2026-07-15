export type ConfigField = {
  path: string;
  env: string;
  group: string;
  name: string;
  type: string;
  choices?: string[] | null;
  description: string;
  value: unknown;
  default: unknown;
};

export type ConfigSchema = {
  envPath: string;
  fields: ConfigField[];
};

export type EditableJob = {
  id: string;
  enabled: boolean;
  path: string;
  alt_filename?: string | null;
  server_path: string;
  type?: string | null;
  post_title?: string | null;
  status: string;
  error?: string | null;
  post?: Record<string, unknown> | null;
};

export type WebTask = {
  id: string;
  kind: "post_download" | "creator_sync";
  title: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "paused";
  params: Record<string, unknown>;
  jobs: EditableJob[];
  logs: string[];
  total: number;
  completed: number;
  failed: number;
  order: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};

export function readToken() {
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get("token");
  if (queryToken) {
    window.localStorage.setItem("ktoolbox_webui_token", queryToken);
    return queryToken;
  }
  return window.localStorage.getItem("ktoolbox_webui_token") || "";
}

export async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-KToolBox-Token": token,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}
