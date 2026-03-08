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
import { z } from "zod";

export const codexToolDefinitions = {
  codex_run: {
    description:
      "Run a prompt using the Codex model through the OpenAI TypeScript SDK.",
    inputSchema: z.object({
      prompt: z.string().describe("The prompt to send to Codex."),
      context: z
        .string()
        .optional()
        .describe("Optional additional context to include."),
    }),
  },
};

export interface CodexPluginOptions {
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
  model?: string;
  /**
   * Working directory for Codex execution.
   */
  workingDirectory?: string;
  /**
   * Skip Codex git repository check. Defaults to true.
   */
  skipGitRepoCheck?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  threadId?: string;
}

export const codexPlugin =
  (options: CodexPluginOptions = {}): MelonyPlugin<any, any> =>
  (builder) => {
    const env = (globalThis as any)?.process?.env as
      | Record<string, string | undefined>
      | undefined;
    const apiKey =
      options.apiKey ?? env?.CODEX_API_KEY ?? env?.OPENAI_API_KEY;
    const model = options.model ?? "gpt-5-codex";

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

    const getThread = () => {
      if (thread) return thread;

      const threadOptions: ThreadOptions = {
        model,
        ...(options.workingDirectory
          ? { workingDirectory: options.workingDirectory }
          : {}),
        skipGitRepoCheck: options.skipGitRepoCheck ?? true,
        ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {}),
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

      thread = options.threadId
        ? client.resumeThread(options.threadId, threadOptions)
        : client.startThread(threadOptions);
      return thread;
    };

    builder.on("action:codex_run" as any, async function* (event) {
      const { toolCallId, prompt, context } = event.data;
      try {
        const turn = await getThread().run(
          context ? `Context:\n${context}\n\nPrompt:\n${prompt}` : prompt
        );
        const text = turn.finalResponse?.trim();
        const result = text && text.length > 0 ? text : "No textual response.";

        yield {
          type: "action:result",
          data: {
            action: "codex_run",
            toolCallId,
            result,
          },
        } as Event;
      } catch (error: any) {
        const message =
          error?.message || "Codex request failed with an unknown error.";

        yield {
          type: "action:result",
          data: {
            action: "codex_run",
            toolCallId,
            result: `Error: ${message}`,
          },
        } as Event;
      }
    });
  };

export const plugin = {
  name: "codex",
  description: "Codex integration tools for OpenBot",
  toolDefinitions: codexToolDefinitions,
  factory: (options: CodexPluginOptions) => codexPlugin(options),
};

export default plugin;
