# codeagent

A small Windows/WSL-compatible Node.js coding REPL using the Claude Agent SDK. No interactive Claude Code launch is required; the SDK itself uses the bundled Claude agent runtime. Node 22+ required. No Python.

## Billing preflight (mandatory)

1. In https://platform.claude.com/settings/billing, switch to the linked organization and check the **promotional** credit balance, not just the total balance. Disable auto-recharge before running. Existing purchased credits may still be consumed. The harness cannot guarantee promotional allocation or prevent all paid consumption.
2. Create a dedicated API key in that organization. Set a low workspace spending limit where available. Do not put the key in source files or system.md.
3. Begin with a small read-only request and inspect the actual Console cost and promotional balance before increasing the budget. SDK estimates are not hard caps; a single request can overshoot. Other processes can spend concurrently. The program stops if no final cost report arrives. Each invocation starts a new budget; it is not a monthly ledger.
4. Official coverage: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers explicitly lists Agent SDK as eligible, not interactive Claude Code. Auto-recharge can trigger even with promotional credits remaining. No live inference has been tested here.

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

The startup shows a masked key and asks you to confirm the billing preflight. The runtime auth source is printed on the first prompt, not verified prior to the first request. Unexpected reported auth sources cause the session to stop. The key is supplied explicitly in the SDK environment, other Anthropic auth/provider variables are removed, and the direct API URL is set. Local SDK settings are disabled. This is not an independent verification of server-side billing or API-key identity. Check Console after the initial test. SDK version/model availability and Windows runtime integration have not been live-tested.

## REPL

```text
codeagent> /add C:\LocalGitRepos\reference-project
codeagent> Compare the current implementation with the reference project. Update only the current repo's README.
codeagent> /cost
codeagent> /roots
codeagent> /reset
codeagent> /exit
```

Reference directories must be explicitly added by the operator (not silently granted based on model output). Absolute or project-relative paths work. The SDK resumes the current conversation across prompts; /reset starts a new conversation but does not reset accumulated spend. Conversation history may be persisted by the SDK on disk. Ctrl+C or closing the terminal interrupts the session; verify the process has stopped before restarting. SDK native tools are disabled. Five custom in-process MCP tools implement Read, Glob, Grep (literal, case-insensitive search), Edit (unique exact replacement), and Write (new files only, existing parent). Existing-file edits are restricted to the current project. Reference directories are read-only. Common credential paths, symlinks and write access to hard-linked files are blocked. Scan results and individual file sizes are capped. No Bash, subagents, external MCP, plugins or arbitrary command execution. This is a file-tool guardrail, not an OS sandbox; concurrent filesystem changes and unusual Windows filesystem aliases are not comprehensively defended against. Review diffs with git and run tests yourself. Do not approve sensitive reference directories; approved file content may be sent to Anthropic.

Edit `system.md` in the installation directory, or set `CODEAGENT_SYSTEM_PROMPT` to another Markdown file. Configuration is via environment variables. No API key fallback is intended. If the SDK reports an unexpected auth source, stop and inspect rather than relaxing the check blindly.

## Validation

Node syntax and local path policy tests only; no npm dependency installation, live API calls, Windows execution, or promotional balance deductions verified in this environment.

SDK: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
