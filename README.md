# @melony/plugin-codex

Minimal Codex plugin scaffold for OpenBot/Melony.

## What is included

- A plugin registry export (`plugin`) compatible with Melony
- One tool definition: `codex_run`
- One action handler: `action:codex_run`
- `@openai/codex-sdk` integration via `Codex` + `thread.run(...)`

## Local usage

1. Install dependencies:

   `npm install`

2. Build:

   `npm run build`

3. Load `dist/index.js` from your OpenBot plugin registry/runtime.

## Runtime config

Set an API key using one of the following:

- `CODEX_API_KEY` environment variable
- `OPENAI_API_KEY` environment variable
- `apiKey` in plugin options

Optional plugin options:

- `model` (defaults to `gpt-5-codex`)
- `baseURL` (for custom OpenAI-compatible endpoints)
- `workingDirectory`, `skipGitRepoCheck`, `sandboxMode`, `approvalPolicy`
- `networkAccessEnabled`, `webSearchMode`, `threadId`
