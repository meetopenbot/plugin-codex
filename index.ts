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

      const apiKey = options.apiKey ?? env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
      const codexPathOverride = options.codexPathOverride ?? env.CODEX_PATH ?? env.CODEX_CLI_PATH;
      const model = options.model?.split("/").pop() || "gpt-5-codex";

      /** Lazily constructed to avoid throwing during registration if CLI is missing. */
      let client: Codex | undefined;
      const getClient = () => {
        if (!client) {
          client = new Codex({
            apiKey,
            ...(codexPathOverride && { codexPathOverride }),
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
          const turn = await getThread(ctx?.state).runStreamed(content);
          for await (const chunk of turn.events) {
            if (chunk.type === 'item.completed') {
              if (chunk.item.type === "agent_message") {
                yield { type: "agent:output", data: { content: chunk.item.text } };
              }
              if (chunk.item.type === "reasoning") {
                yield { type: "agent:output", data: { content: chunk.item.text } };
              }
              if (chunk.item.type === "command_execution") {
                yield { type: "agent:output", data: { content: chunk.item.command } };
              }
              if (chunk.item.type === "file_change") {
                yield { type: "agent:output", data: { content: chunk.item.changes.map((change: any) => `${change.path}: ${change.action}`).join("\n") } };
              }
              if (chunk.item.type === "error") {
                yield { type: "agent:output", data: { content: `Error: ${chunk.item.message}` } };
              }
              if (chunk.item.type === "todo_list") {
                yield { type: "agent:output", data: { content: chunk.item.items.map((item: any) => `- ${item.text} (${item.completed ? "completed" : "pending"})`).join("\n") } };
              }
              if (chunk.item.type === "web_search") {
                yield { type: "agent:output", data: { content: `Query: ${chunk.item.query}` } };
              }
            }
          }
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
