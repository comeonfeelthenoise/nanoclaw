---
name: gemini
description: Call Gemini Flash for large-context research and analysis. Automatically uses context caching when context exceeds 32K tokens. Use for patent searches, Obsidian vault analysis, stock report reading, and any task involving large documents.
---

# Gemini Flash Tool

Use this tool to offload large-context analysis to Gemini Flash. It automatically applies context caching when context exceeds ~32K tokens.

## When to use Gemini vs yourself

| Task | Use |
|------|-----|
| Read + analyze many documents or a large file | **Gemini** |
| Obsidian vault reorganization / tagging | **Gemini** |
| Patent prior art search across many filings | **Gemini** |
| Stock report or earnings call analysis | **Gemini** |
| Code generation or code review | **You (Claude)** |
| Patent claim drafting / investment thesis writing | **You (Claude)** |
| Multi-step planning or complex reasoning | **You (Claude)** |

## Usage

```bash
node ~/.claude/skills/gemini/gemini.mjs "<prompt>"
node ~/.claude/skills/gemini/gemini.mjs "<prompt>" --context "<inline text>"
node ~/.claude/skills/gemini/gemini.mjs "<prompt>" --context-file "<path>"
node ~/.claude/skills/gemini/gemini.mjs "<prompt>" --context-dir "<directory>"
node ~/.claude/skills/gemini/gemini.mjs "<prompt>" --system "<system instruction>"
```

- `--context-dir` loads all `.md`, `.txt`, `.json`, `.csv` files in the directory (recursively, up to 8MB)
- Context caching is automatic — no flags needed
- Stderr shows token estimates and cache status; stdout is the response

## Examples

### Obsidian vault analysis
```bash
node ~/.claude/skills/gemini/gemini.mjs \
  "이 노트들을 주제별로 분류하고 서로 연결되지 않은 고아 노트 목록을 만들어줘" \
  --context-dir /workspace/extra/obsidian
```

### Patent prior art search
```bash
node ~/.claude/skills/gemini/gemini.mjs \
  "아래 발명 아이디어와 관련된 선행기술을 특허문헌에서 찾아 요약해줘" \
  --context-dir /workspace/extra/patents \
  --system "You are a patent examiner specializing in prior art searches."
```

### Stock report analysis
```bash
node ~/.claude/skills/gemini/gemini.mjs \
  "핵심 리스크 요인, 투자 포인트, 목표주가 요약해줘" \
  --context-file /workspace/extra/reports/samsung-q1.txt
```

### Inline context
```bash
node ~/.claude/skills/gemini/gemini.mjs \
  "이 데이터에서 트렌드를 분석해줘" \
  --context "$(cat /workspace/extra/data.csv)"
```

## Workflow: Research → Write

For patent drafting or investment reports, use this two-step pattern:

1. **Gemini researches** (large context, fast, cheap)
2. **You write** (structured output, high quality)

```bash
# Step 1: Gemini reads and extracts
RESEARCH=$(node ~/.claude/skills/gemini/gemini.mjs \
  "선행기술 핵심 내용만 bullet point로 추출해줘" \
  --context-dir /workspace/extra/patents)

# Step 2: You draft with the extracted info
echo "$RESEARCH"  # read it, then write the patent claims yourself
```

## Environment

- `GEMINI_API_KEY`: Required (injected automatically from `.env`)
- `GEMINI_MODEL`: Optional override (default: `gemini-2.0-flash-001`)
