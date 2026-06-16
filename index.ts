import {
  definePlugin,
  shouldHandleInvoke,
  agentOutput,
  uiWidget,
} from "@meetopenbot/plugin-sdk";
import {
  Codex,
  type ApprovalMode,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk";

export default definePlugin({
  id: "codex",
  name: "Codex",
  description: "Codex integration tools for OpenBot",
  configSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "Codex API Key", format: "password" },
      baseURL: { type: "string", description: "Custom OpenAI-compatible endpoint" },
      codexPathOverride: { type: "string", description: "Path to codex CLI" },
      model: { type: "string", description: "Model to use", default: "gpt-5-codex" },
      workingDirectory: { type: "string", description: "Working directory for Codex" },
      skipGitRepoCheck: { type: "boolean", description: "Skip git repo check", default: true },
      sandboxMode: {
        type: "string",
        enum: ["workspace-read", "workspace-write", "full-read", "full-write"],
        description: "Sandbox mode",
        default: "workspace-write",
      },
      approvalPolicy: {
        type: "string",
        enum: ["always", "never", "automatic"],
        description: "Approval policy",
        default: "never",
      },
      networkAccessEnabled: { type: "boolean", description: "Enable network access" },
      webSearchMode: {
        type: "string",
        enum: ["always", "never", "automatic"],
        description: "Web search mode",
      },
    },
  },
  factory: (context) => {
    const config = context.config as any;
    const env = (globalThis as any)?.process?.env || {};

    const apiKey = config.apiKey ?? env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
    const codexPathOverride = config.codexPathOverride ?? env.CODEX_PATH ?? env.CODEX_CLI_PATH;
    const model = config.model?.split("/").pop() || "gpt-5-codex";

    /** Lazily constructed to avoid throwing during registration if CLI is missing. */
    let client: Codex | undefined;
    const getClient = () => {
      if (!client) {
        client = new Codex({
          apiKey,
          ...(codexPathOverride && { codexPathOverride }),
          ...(config.baseURL && { baseUrl: config.baseURL }),
        });
      }
      return client;
    };

    let thread: Thread | null = null;
    const getThread = (state?: any, meta?: any) => {
      if (thread) return thread;

      const workingDirectory =
        config.workingDirectory ||
        state?.channelDetails?.cwd ||
        (globalThis as any)?.process?.cwd() ||
        "/tmp";

      const threadOptions: ThreadOptions = {
        model,
        workingDirectory,
        skipGitRepoCheck: config.skipGitRepoCheck ?? true,
        sandboxMode: (config.sandboxMode as SandboxMode) ?? "workspace-write",
        approvalPolicy: (config.approvalPolicy as ApprovalMode) ?? "never",
        ...(typeof config.networkAccessEnabled === "boolean" && {
          networkAccessEnabled: config.networkAccessEnabled,
        }),
        ...(config.webSearchMode && {
          webSearchMode: config.webSearchMode as WebSearchMode,
        }),
      };

      const threadId = state?.threadId || meta?.threadId;
      thread = threadId
        ? getClient().resumeThread(threadId, threadOptions)
        : getClient().startThread(threadOptions);

      if (!threadId && state) {
        state.threadId = thread.id;
      }

      return thread;
    };

    return (builder) => {
      builder.on("agent:invoke", async function* (event, ctx) {
        if (!shouldHandleInvoke(event, context.agentId)) return;

        const { content } = event.data || {};
        if (!content) {
          yield agentOutput({
            agentId: context.agentId,
            content: "No content provided.",
            threadId: event.meta?.threadId,
          });
          return;
        }

        try {
          const turn = await getThread(ctx?.state, event.meta).runStreamed(content);
          for await (const chunk of turn.events) {
            if (chunk.type === "item.completed") {
              const { item } = chunk as any;

              if (item.type === "agent_message") {
                yield agentOutput({
                  agentId: context.agentId,
                  content: item.text,
                  threadId: event.meta?.threadId,
                });
                continue;
              }

              let title = "";
              let body = "";

              switch (item.type) {
                case "reasoning":
                  title = "Reasoning";
                  body = item.text;
                  break;
                case "command_execution":
                  title = "Command Execution";
                  body = `Executing: ${item.command}`;
                  break;
                case "file_change":
                  title = "File Change";
                  body = item.changes
                    .map((change: any) => `${change.path}: ${change.kind || change.action}`)
                    .join("\n");
                  break;
                case "mcp_tool_call":
                  title = `Tool: ${item.tool}`;
                  body = `Arguments: ${JSON.stringify(item.arguments, null, 2)}`;
                  if (item.result) {
                    body += `\n\nResult: ${JSON.stringify(
                      item.result.structured_content || item.result.content,
                      null,
                      2
                    )}`;
                  }
                  if (item.error) {
                    body += `\n\nError: ${item.error.message}`;
                  }
                  break;
                case "web_search":
                  title = "Web Search";
                  body = `Searching: ${item.query}`;
                  break;
                case "todo_list":
                  title = "Todo List";
                  body = item.items
                    .map(
                      (todo: any) =>
                        `- ${todo.text} (${todo.completed ? "completed" : "pending"})`
                    )
                    .join("\n");
                  break;
                case "error":
                  title = "Error";
                  body = item.message;
                  break;
              }

              if (title && body) {
                yield uiWidget({
                  agentId: context.agentId,
                  threadId: event.meta?.threadId,
                  widget: {
                    kind: "message",
                    title,
                    body,
                    // @ts-ignore
                    variant: "basic",
                    display: "collapsed",
                  },
                });
              }
            }
          }
        } catch (error: any) {
          yield agentOutput({
            agentId: context.agentId,
            content: `Error: ${error?.message || "Codex request failed."}`,
            threadId: event.meta?.threadId,
          });
        }
      });
    };
  },
});
