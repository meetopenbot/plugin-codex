import { Event, MelonyPlugin } from "melony";
import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk";

export interface CodexPluginOptions {
  // this first options are passed from AGENT.md as its used as a Runtime plugin for the Agent.
  name?: string;
  instructions?: string;
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
  model: string;
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
  (
    options: CodexPluginOptions = { model: "gpt-5-codex" },
  ): MelonyPlugin<any, any> =>
  (builder) => {
    const env = (globalThis as any)?.process?.env as
      | Record<string, string | undefined>
      | undefined;
    const apiKey = options.apiKey ?? env?.CODEX_API_KEY ?? env?.OPENAI_API_KEY;
    let model =
      typeof options.model === "string" && options.model.trim()
        ? options.model
        : "gpt-5-codex";

    // if model is formatted as "openai/gpt-5-codex", then extract the model name
    if (model.includes("/")) {
      model = model.split("/")[1] ?? "gpt-5-codex";
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
          : {
              workingDirectory: (globalThis as any)?.process?.cwd() || "/tmp",
            }),
        skipGitRepoCheck: options.skipGitRepoCheck ?? false,
        ...(options.sandboxMode
          ? { sandboxMode: options.sandboxMode }
          : {
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

    builder.on("agent:invoke" as any, async function* (event, ctx) {
      const { content } = event.data;
      const state = ctx?.state || {};

      // if content is empty, then return an error
      if (!content) {
        yield {
          type: "agent:output",
          data: {
            content: "No content provided.",
          },
        } as Event;

        return;
      }

      try {
        const turn = await getThread(state).run(content);
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
  name: "Codex",
  description: "Codex integration tools for OpenBot",
  factory: (options: CodexPluginOptions) => codexPlugin(options),
};
