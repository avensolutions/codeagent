# codeagent

A small Windows/WSL-compatible Node.js coding REPL that calls the Claude API directly through the Anthropic TypeScript SDK (`@anthropic-ai/sdk`). It runs its own agent loop and does not use or download Claude Code. Node 22+ required. No Python.

## Billing preflight (mandatory)

1. In https://platform.claude.com/settings/billing, switch to the linked organization and check the **promotional** credit balance, not just the total balance. Disable auto-recharge before running. Existing purchased credits may still be consumed. The harness cannot guarantee promotional allocation or prevent all paid consumption.
2. Create a dedicated API key in that organization. Set a low workspace spending limit where available. Do not put the key in source files or system.md.
3. Begin with a small read-only request and inspect the actual Console cost and promotional balance before increasing the budget. Costs are estimated locally from the token usage each response reports and the prices in `pricing.mjs`; they are not billing caps. Each model call's output limit is set so its output cannot cost more than what is left of the prompt budget, but the input of a single call can still overshoot. Other processes can spend concurrently. If a request fails in a way that may have been billed without a usage report (server error, dropped stream, network failure), the session ends. Each invocation starts a new budget; it is not a monthly ledger.
4. Official coverage: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers lists the Claude API as covered and Claude Code as not covered. Auto-recharge can trigger even with promotional credits remaining.

## Install (PowerShell)

Extract the archive and open PowerShell in the extracted `codeagent` directory.

```powershell
npm install
npm test
npm link
```

`npm link` creates a global command shim; keep this source folder. If not found, ensure the npm global prefix (`npm prefix -g`) is on PATH. Use `codeagent.cmd` if PowerShell script execution policy blocks the shim. WSL requires its own installation and Linux paths.

```powershell
cd C:\LocalGitRepos\my-project
# If not already set, read without echo (PowerShell 7):
$env:ANTHROPIC_API_KEY = Read-Host 'Anthropic API key' -MaskInput
$env:CODEAGENT_BUDGET_USD = '1.00'
$env:CODEAGENT_TURN_USD = '0.25'
$env:CODEAGENT_MODEL = 'claude-fable-5-2'
codeagent.cmd
```

- `CODEAGENT_BUDGET_USD` (required): estimated spend limit for one session.
- `CODEAGENT_TURN_USD` (default `0.50`): estimated spend limit for one prompt.
- `CODEAGENT_MAX_CALLS` (default `10`): most model calls one prompt can make. When a prompt reaches it, tool results so far are kept and you can send "continue".
- `CODEAGENT_MODEL` (default `claude-fable-5-2`): must be one of the models priced in `pricing.mjs`. Update that file when prices change or to add a model.

The startup shows a masked key and asks you to confirm the billing preflight. The key is passed to the SDK client as its only credential, every other `ANTHROPIC_*` environment variable is removed at startup, and the API URL is fixed to https://api.anthropic.com. The server first checks the key on your first prompt. This is not an independent verification of server-side billing or API-key identity. Check Console after the initial test.

## REPL

```text
codeagent> /add C:\LocalGitRepos\reference-project
codeagent> Compare the current implementation with the reference project. Update only the current repo's README.
codeagent> /cost
codeagent> /roots
codeagent> /info
codeagent> /reset
codeagent> /exit
```

Reference directories must be explicitly added by the operator (not silently granted based on model output). Absolute or project-relative paths work. The conversation is kept in memory across prompts and is not written to disk; /reset starts a new conversation but does not reset accumulated spend. Ctrl+C or closing the terminal interrupts the session; verify the process has stopped before restarting. The model has five tools, implemented locally in `cli.mjs`: Read, Glob, Grep (literal, case-insensitive search), Edit (unique exact replacement), and Write (new files only, existing parent). Existing-file edits are restricted to the current project. Reference directories are read-only. Common credential paths, symlinks and write access to hard-linked files are blocked. Scan results and individual file sizes are capped. No Bash, subagents, MCP, plugins or arbitrary command execution. This is a file-tool guardrail, not an OS sandbox; concurrent filesystem changes and unusual Windows filesystem aliases are not comprehensively defended against. Review diffs with git and run tests yourself. Do not approve sensitive reference directories; approved file content may be sent to Anthropic.

Each prompt runs a loop: send the conversation, run any tool calls locally, send the results back, and repeat until the model finishes, the prompt budget runs out, or `CODEAGENT_MAX_CALLS` calls have been made. Responses are printed as they stream in. While the model is thinking or writing a tool call, a status line shows what it is doing and for how long, and after each call that leads to tool use, a line shows that call's estimated cost. Prompt caching is on, so the earlier part of the conversation is billed at the cache-read rate on later calls. The system prompt and tool definitions stay fixed for the session, because the API rejects the model's earlier reasoning if either changes mid-conversation. On models listed in `FALLBACK_MODELS` in `pricing.mjs`, the server-side refusal fallback is on: if the model declines a request, the API retries it on a fallback model, billed at that model's rates. A prompt that is still declined is removed from the conversation.

Edit `system.md` in the installation directory, or set `CODEAGENT_SYSTEM_PROMPT` to another Markdown file. Configuration is via environment variables. No API key fallback is intended.

## Versioning

The version in `package.json` follows semver and is shown at startup and by `/info`. Bump it with each change you commit: patch for fixes, minor for new features or behavior changes (major once the tool is past 1.0). There is no build step, so `/info` shows the git commit and commit date of the folder `codeagent` runs from instead of a build date, and says when that folder has uncommitted changes. It also shows the Node and SDK versions, the model with its prices, and the budgets.

## Validation

`npm test` runs the path policy and cost calculation tests. The request loop has been checked against a local fake API (tool calls, refusals, fallbacks, API errors, budget limits) but not against the live API.

SDK: https://www.npmjs.com/package/@anthropic-ai/sdk
