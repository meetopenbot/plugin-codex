import { execSync } from "child_process";
import { MelonyPlugin } from "melony";
import {
  Codex,
  type ApprovalMode,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk";

export interface CodexPluginOptions {
  name?: string;
  instructions?: string;
  mode?: "coding" | "asking" | "planning";
  apiKey?: string;
  baseURL?: string;
  codexPathOverride?: string;
  model: string;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
}

export const codexPlugin =
  (options: CodexPluginOptions = { model: "gpt-5-codex" }): MelonyPlugin<any, any> =>
    (builder) => {
      const env = (globalThis as any)?.process?.env || {};

      const resolveCodexPath = (): string | undefined => {
        const explicit = options.codexPathOverride ?? env.CODEX_PATH ?? env.CODEX_CLI_PATH;
        if (explicit) return explicit;

        // Try local node_modules first
        const localPath = "./node_modules/.bin/codex";
        try {
          execSync(`${localPath} --version`, { stdio: "ignore" });
          return localPath;
        } catch {
          // Fallback to system PATH
          try {
            const cmd = (globalThis as any)?.process?.platform === "win32" ? "where codex" : "which codex";
            return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0].trim();
          } catch {
            return undefined;
          }
        }
      };

      const apiKey = options.apiKey ?? env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
      const codexPath = resolveCodexPath();
      const model = options.model?.split("/").pop() || "gpt-5-codex";

      /** Lazily constructed to avoid throwing during registration if CLI is missing. */
      let client: Codex | undefined;
      const getClient = () => {
        if (!client) {
          client = new Codex({
            apiKey,
            ...(codexPath && { codexPathOverride: codexPath }),
            ...(options.baseURL && { baseUrl: options.baseURL }),
          });
        }
        return client;
      };

      let thread: Thread | null = null;
      const getThread = (state?: any) => {
        if (thread) return thread;

        const workingDirectory = options.workingDirectory || state?.channelDetails?.cwd || (globalThis as any)?.process?.cwd() || "/tmp";

        const threadOptions: ThreadOptions = {
          model,
          workingDirectory,
          skipGitRepoCheck: options.skipGitRepoCheck ?? false,
          sandboxMode: options.sandboxMode ?? "workspace-write",
          ...(options.approvalPolicy && { approvalPolicy: options.approvalPolicy }),
          ...(typeof options.networkAccessEnabled === "boolean" && { networkAccessEnabled: options.networkAccessEnabled }),
          ...(options.webSearchMode && { webSearchMode: options.webSearchMode }),
        };

        const threadId = state?.threadId;
        thread = threadId ? getClient().resumeThread(threadId, threadOptions) : getClient().startThread(threadOptions);

        if (!threadId && state) {
          state.threadId = thread.id;
        }

        return thread;
      };

      builder.on("agent:invoke" as any, async function* (event, ctx) {
        const { content } = event.data;
        if (!content) {
          yield { type: "agent:output", data: { content: "No content provided." } };
          return;
        }

        try {
          const turn = await getThread(ctx?.state).run(content);
          const result = turn.finalResponse?.trim() || "No textual response.";
          yield { type: "agent:output", data: { content: result } };
        } catch (error: any) {
          yield {
            type: "agent:output",
            data: { content: `Error: ${error?.message || "Codex request failed."}` },
          };
        }
      });
    };

export const plugin = {
  id: "codex",
  name: "Codex",
  description: "Codex integration tools for OpenBot",
  kind: "runtime" as const,
  factory: (options: CodexPluginOptions) => codexPlugin(options),
};
