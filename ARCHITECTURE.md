# AgentBoard - Agent Command Center IDE

## Architecture Overview

VSCode-style client-server split: GUI layer (local PC/browser) ↔ Remote Server (where Claude Code agents run)

```
┌─────────────────────────────────────────────────────┐
│  AgentBoard GUI (React, runs in browser)            │
│  ┌───────────────┬──────────────┬──────────────────┐│
│  │ Layer 1       │ Layer 2      │ Layer 3          ││
│  │ Overview      │ Decision     │ Detail View      ││
│  │ (10 projects) │ Queue        │ (on demand)      ││
│  └───────────────┴──────────────┴──────────────────┘│
│            ↕ WebSocket (JSON-RPC)                    │
├─────────────────────────────────────────────────────┤
│  AgentBoard Server (Node.js, on remote Linux)       │
│  ┌─────────────────────────────────────────────────┐│
│  │ Session Monitor                                 ││
│  │ - watches ~/.claude/projects/*/sessions/*.jsonl  ││
│  │ - parses JSONL in real-time (tail -f style)     ││
│  │ - detects: tool calls, Stop events, errors      ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │ State Interpreter (LLM-powered)                 ││
│  │ - summarizes agent activity → structured state  ││
│  │ - detects "needs human input" patterns          ││
│  │ - generates decision queue items                ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │ Agent Controller                                ││
│  │ - tmux sessions as execution substrate          ││
│  │ - send-keys to inject human decisions           ││
│  │ - launch / stop / resume agents                 ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │ Hook Manager                                    ││
│  │ - installs hooks into ~/.claude/settings.json   ││
│  │ - hooks fire HTTP POST to AgentBoard Server     ││
│  │ - events: Stop, PostToolUse, Notification       ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Agent → Server (passive monitoring)
```
~/.claude/projects/<project>/sessions/<session>.jsonl
  → fs.watch() detects changes
  → parse new JSONL lines
  → extract: tool calls, messages, token usage, errors
  → update in-memory project state
```

### 2. Agent → Server (active hooks)
```
Claude Code hook (Stop event) fires
  → HTTP POST to http://localhost:7432/hooks/stop
  → payload: { session_id, project, last_message, ... }
  → server updates state: "agent stopped, awaiting input"
  → WebSocket push to GUI: new decision queue item
```

### 3. Human → Agent (via GUI)
```
Human clicks "Approve Option A" in GUI
  → WebSocket message to server
  → server resolves: tmux session = "project-alpha"
  → tmux send-keys -t project-alpha "A案で進めてください" Enter
  → Claude Code receives input, continues working
```

## Hook Configuration

Installed into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:7432/hooks/stop -H 'Content-Type: application/json' -d \"$(cat)\""
      }]
    }],
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:7432/hooks/notification -H 'Content-Type: application/json' -d \"$(cat)\""
      }]
    }],
    "PostToolUse": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:7432/hooks/post-tool-use -H 'Content-Type: application/json' -d \"$(cat)\""
      }]
    }]
  }
}
```

## Session File Structure (reference)

```
~/.claude/
├── projects/
│   └── <url-encoded-project-path>/
│       ├── sessions/
│       │   └── <session-uuid>.jsonl   ← full transcript
│       └── session-memory/
│           └── summary.md
├── history.jsonl                       ← global prompt index
└── settings.json                       ← hooks config here
```

Each JSONL line contains:
- role (user/assistant/system)
- tool calls with inputs/outputs
- token usage per turn
- extended thinking blocks
- model selection
- working directory, git state

## GUI Layers

### Layer 1: Overview (always visible, top/left)
10 project cards showing:
- Project name + git branch
- Phase: 🟢 autonomous | 🟡 review-soon | 🔴 blocked/waiting
- Active agent count
- Last activity timestamp
- Token spend (session)
- Mini progress indicator

### Layer 2: Decision Queue (main area)
Priority-sorted list of items needing human input:
- Which project, what question
- Agent's suggested options (A/B/C or Yes/No)
- Agent confidence level
- Estimated decision time (30s / 2min / needs-deep-review)
- One-click approve buttons
- Screenshot/diff preview inline

### Layer 3: Detail View (expandable panel)
- Agent activity log (summarized, not raw JSONL)
- Code diffs
- Terminal output (optional raw tmux pane view)
- Direct text input to agent
- Session cost breakdown

## tmux Management

```bash
# Launch new agent for a project
tmux new-session -d -s "project-alpha" \
  "cd /path/to/project-alpha && claude --dangerously-skip-permissions"

# Send human decision
tmux send-keys -t "project-alpha" "承認します。A案で進めてください。" Enter

# Capture current screen (fallback if hooks miss something)
tmux capture-pane -t "project-alpha" -p

# List all agent sessions
tmux list-sessions -F "#{session_name}: #{session_activity}"
```

## Tech Stack

### Server (remote Linux)
- Node.js + TypeScript
- Express for hook HTTP endpoints
- ws (WebSocket) for GUI communication
- chokidar for file watching
- node-pty (optional, for direct terminal embedding)
- Anthropic API (for state interpretation/summarization)

### GUI (local browser)
- React + TypeScript
- Tailwind CSS
- Reconnecting WebSocket
- Responsive (works on mobile for quick approvals)

## MVP Scope

Phase 1: Read-only dashboard
- Watch ~/.claude session files
- Parse and display project states
- Show activity timeline

Phase 2: Decision queue
- Hook integration (Stop, Notification)
- LLM summarization of "what needs deciding"
- One-click approvals

Phase 3: Agent control
- tmux send-keys integration
- Launch/stop agents from GUI
- Mobile-optimized approval flow
