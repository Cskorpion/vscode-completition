# vscode-tab-complete

Inline code completions for VS Code, powered by the **pi coding agent** running as a subprocess.

The extension never talks to an LLM API itself. It spawns the locally installed `pi` CLI in non-interactive print mode and pipes the code context around the cursor through stdin. pi owns everything LLM-related: provider and model configuration (`~/.pi/agent/settings.json`), authentication, retries.

```
VS Code (keystroke)
  -> PiInlineCompletionProvider        debounce, LRU cache, accept tracking
    -> runPiCompletion()               spawns `pi --print ...`, kills on supersede/timeout
      -> pi                           resolves provider/model/auth
        -> LLM
```

## Features

- **Inline ghost-text completions** in every text file, debounced per keystroke burst.
- **Real cancellation**: when a newer keystroke arrives, the previous pi subprocess is killed immediately (no zombie LLM requests). A configurable timeout kills hung requests.
- **LRU cache** for identical contexts (typo, undo, VS Code re-query) — no duplicate LLM calls.
- **Acceptance tracking**: after Tab, an identical completion is not re-suggested at the new cursor, breaking suggestion loops.
- **Defensive output cleanup**: stray markdown code fences from the model are stripped.
- **Safety flags**: pi runs with `--no-tools --no-session --no-extensions ...`, so a completion request can never execute tools, persist sessions, or pick up project-local pi configuration.

## Requirements

- The `pi` coding agent installed and authenticated, see `pi --help` / `pi auth check`.
- Either:
  - VS Code with **Remote-WSL** (extension host runs inside WSL), or
  - VS Code on Windows with WSL available (`wsl.exe`).

## Configuration

| Setting | Default | Description |
|---|---|---|
| `vscodeTabComplete.command` | `["pi"]` | Launch command. `["wsl.exe", "-e", "pi"]` when VS Code runs on Windows. |
| `vscodeTabComplete.model` | `""` | Optional `--model` for pi. Empty = pi's default. |
| `vscodeTabComplete.debounceMs` | `600` | Keystroke debounce before pi is asked. |
| `vscodeTabComplete.timeoutMs` | `15000` | Hard kill limit for the pi subprocess. |
| `vscodeTabComplete.contextPrefixChars` | `2000` | Context characters before the cursor. |
| `vscodeTabComplete.contextSuffixChars` | `1000` | Context characters after the cursor. |
| `vscodeTabComplete.debug` | `false` | Log to the "vscode-tab-complete" output channel. |

**Model choice:** a fast, non-thinking model is recommended for completions (e.g. `glm-5.3-flash-nvfp4`). Thinking models can exceed the timeout on completion prompts; raise `vscodeTabComplete.timeoutMs` if you use one deliberately.

## Development

```bash
npm install
npm run compile        # build src/ -> out/
npm run watch          # incremental build
npm test               # build + run the unit tests (no LLM involved)
```

Run/Debug the extension: open this folder in VS Code and press **F5** (`.vscode/launch.json` launches an Extension Development Host).

Package a `.vsix`:

```bash
npm run package
```

### Tests

Tests use the built-in Node test runner and a **fake spawn function** — they cover the subprocess lifecycle (stdin piping, stdout capture, timeouts, aborts, exit codes), prompt construction, output cleanup, the LRU cache and acceptance tracking. No vscode API and no LLM is involved; the provider itself is exercised manually via F5.

### Project layout

```
src/
  extension.ts        entry point: wiring into VS Code
  provider.ts         inline completion provider (debounce, cache, accept tracking)
  configuration.ts    settings reader with clamping
  log.ts              lazy output-channel logger
  cache.ts            LRU completion cache
  acceptance.ts       accepted-completion tracker
  util.ts             sleep/abort helpers
  pi/
    piAgent.ts        subprocess backend: argv contract, spawn, kill, timeout
    promptBuilder.ts  context slicing, prompt + system prompt
    postprocess.ts    defensive model-output cleanup
test/                 unit tests (node:test)
```

## Notes

- The `runtimeHints.run` command declaration from the old prototype (Racket type hints) was removed; it was never implemented. Re-add it in its own commit when that feature takes shape.
- Change the `publisher` field in `package.json` before publishing anywhere.
