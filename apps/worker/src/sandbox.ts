import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

export type SandboxIsolation = "network-namespace" | "seatbelt" | "restricted-env";
export type SandboxResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  isolation: SandboxIsolation;
};

const OUTPUT_LIMIT = 256 * 1024;
const SEATBELT_DENY_NETWORK = '(version 1)(allow default)(deny network*)';

async function commandExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectIsolation(allowNetwork: boolean): Promise<SandboxIsolation> {
  if (allowNetwork) return "restricted-env";
  if (process.platform === "linux" && await commandExists("/usr/bin/unshare")) return "network-namespace";
  if (process.platform === "darwin" && await commandExists("/usr/bin/sandbox-exec")) return "seatbelt";
  return "restricted-env";
}

export async function runSandboxed(options: {
  workdir: string;
  command: string[];
  timeoutMs?: number;
  allowNetwork?: boolean;
  env?: Record<string, string>;
}): Promise<SandboxResult> {
  const allowNetwork = options.allowNetwork ?? false;
  const timeoutMs = Math.min(options.timeoutMs ?? 120_000, 600_000);
  const isolation = await detectIsolation(allowNetwork);
  const argv = isolation === "network-namespace"
    ? ["unshare", "-rn", "--", ...options.command]
    : isolation === "seatbelt"
      ? ["sandbox-exec", "-p", SEATBELT_DENY_NETWORK, ...options.command]
      : options.command;
  // With no isolation primitive available, unroutable proxies are a soft guard
  // for well-behaved tooling; the recorded isolation level keeps this honest.
  const networkGuard: Record<string, string> = !allowNetwork && isolation === "restricted-env"
    ? { HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "" }
    : {};
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: options.workdir,
    TMPDIR: join(options.workdir, ".tmp"),
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    NO_COLOR: "1",
    ...networkGuard,
    ...options.env,
  };

  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: options.workdir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut, durationMs: Date.now() - startedAt, isolation });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, stdout: stdout.slice(0, OUTPUT_LIMIT), stderr: stderr.slice(0, OUTPUT_LIMIT), timedOut, durationMs: Date.now() - startedAt, isolation });
    });
  });
}
