import { Event, MelonyPlugin } from "melony";
import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk"

export interface CodexPluginOptions {
  // this first options are because the plugin is used as a BASE plugin for the BOT
  system?: string;
  toolDefinitions?: Record<string, any>;
  /**
   * Mode of the plugin.
   */
  mode?: "coding" | "asking" | "planning"; // we can implement it later
  /**
   * Optional API key override.
   */
  apiKey?: string;
  /**
   * Optional base URL override for Codex API.
   */
  baseURL?: string;
  /**
   * Codex model to use for threads.
   */
  model: {
    modelId: string;
  },
  /**
   * Working directory for Codex execution.
   */
  workingDirectory?: string;
  /**
   * Skip Codex git repository check. Defaults to false.
   */
  skipGitRepoCheck?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
}

export const codexPlugin =
  (options: CodexPluginOptions = { model: { modelId: "gpt-5-codex" } }): MelonyPlugin<any, any> =>
    (builder) => {

      const env = (globalThis as any)?.process?.env as
        | Record<string, string | undefined>
        | undefined;
      const apiKey =
        options.apiKey ?? env?.CODEX_API_KEY ?? env?.OPENAI_API_KEY;
      const model =
        typeof options.model.modelId === "string" && options.model.modelId.trim()
          ? options.model.modelId
          : "gpt-5-codex";

      if (!apiKey) {
        throw new Error(
          "Missing Codex API key. Set CODEX_API_KEY/OPENAI_API_KEY or pass apiKey in codex plugin options."
        );
      }

      const codexOptions: CodexOptions = {
        apiKey,
        ...(options.baseURL ? { baseUrl: options.baseURL } : {}),
      };
      const client = new Codex(codexOptions);
      let thread: Thread | null = null;

      const getThread = (state?: any) => {
        if (thread) return thread;

        const threadOptions: ThreadOptions = {
          model,
          ...(options.workingDirectory
            ? { workingDirectory: options.workingDirectory }
            : { workingDirectory: "/Users/darasstayhome/root/readmeto" }),
          skipGitRepoCheck: options.skipGitRepoCheck ?? false,
          ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {
            sandboxMode: "workspace-write",
          }),
          ...(options.approvalPolicy
            ? { approvalPolicy: options.approvalPolicy }
            : {}),
          ...(typeof options.networkAccessEnabled === "boolean"
            ? { networkAccessEnabled: options.networkAccessEnabled }
            : {}),
          ...(options.webSearchMode
            ? { webSearchMode: options.webSearchMode }
            : {}),
        };

        const threadId = state?.threadId ?? undefined;

        thread = threadId
          ? client.resumeThread(threadId, threadOptions)
          : client.startThread(threadOptions);

        if (!threadId) {
          if (state) (state as any).threadId = thread.id;
        }

        return thread;
      };

      builder.on("agent:input" as any, async function* (event, ctx) {
        const { content } = event.data;
        const state = ctx?.state || {};

        try {
          const turn = await getThread(state).run(
            content
          );
          const text = turn.finalResponse?.trim();
          const result = text && text.length > 0 ? text : "No textual response.";

          yield {
            type: "agent:output",
            data: {
              content: result,
            },
          } as Event;
        } catch (error: any) {
          const message =
            error?.message || "Codex request failed with an unknown error.";

          yield {
            type: "agent:output",
            data: {
              content: `Error: ${message}`,
            },
          } as Event;
        }
      });
    };

export const plugin = {
  name: "codex",
  type: "agent",
  description: "Codex integration tools for OpenBot",
  factory: (options: CodexPluginOptions) => codexPlugin(options),
};

export default plugin;
