#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash tools/agent_finisher/run_finisher.sh 3   (runs 3 iterations)

ITERATIONS="${1:-2}"
MODEL="${OPENAI_MODEL:-gpt-5}"
API_KEY="${OPENAI_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "[finisher] ERROR: OPENAI_API_KEY is not set."
  exit 1
fi

ROOT="$(pwd)"
OUTROOT="$ROOT/tools/agent_finisher/out"
mkdir -p "$OUTROOT"

timestamp() { date +"%Y%m%d_%H%M%S"; }

run_builds() {
  echo "[finisher] build shared/server/web..."
  pnpm -C packages/shared run build
  pnpm -C apps/server run build
  pnpm -C apps/web run build
}

run_harness() {
  local run_dir="$1"
  echo "[finisher] running harness..."
  bash tools/overnight/run_v3.sh --minutes 15 --sessions 3000 --turns 24 --concurrency 2 | tee "$run_dir/harness.log" || true

  # locate latest run folder (v3 sometimes writes to different roots)
  local cand=""
  for c in "$ROOT/tools/overnight/out_v3" "$ROOT/tools/overnight/out" "$ROOT/apps/server/tools/overnight/out"; do
    if [[ -d "$c" ]]; then
      cand="$(ls -1dt "$c"/run_* 2>/dev/null | head -n 1 || true)"
      if [[ -n "$cand" ]]; then break; fi
    fi
  done

  if [[ -n "$cand" ]]; then
    echo "$cand" > "$run_dir/RUN_DIR.txt"
    for f in metrics.json overnight_report.md top_terms_unknown.json regex_suggestions.md facts_todo.md failures.csv raw_requests.json events.jsonl; do
      [[ -f "$cand/$f" ]] && cp -f "$cand/$f" "$run_dir/$f" || true
    done
  else
    echo "[finisher] WARNING: no run_* folder detected"
  fi
}

git_snapshot() {
  local run_dir="$1"
  git status --porcelain > "$run_dir/git_status.txt" || true
  git diff > "$run_dir/git_diff.patch" || true
  git log --oneline -5 > "$run_dir/git_log.txt" || true
}

call_openai_for_patch() {
  local run_dir="$1"
  local prompt_file="$run_dir/prompt.txt"
  local response_file="$run_dir/openai_response.json"
  local patch_file="$run_dir/patch.diff"
  local files_dir="$run_dir/new_files"
  mkdir -p "$files_dir"

  # Gather artifacts (truncate big ones)
  local report="$(cat "$run_dir/overnight_report.md" 2>/dev/null | head -c 120000 || true)"
  local metrics="$(cat "$run_dir/metrics.json" 2>/dev/null | head -c 80000 || true)"
  local unknown="$(cat "$run_dir/top_terms_unknown.json" 2>/dev/null | head -c 80000 || true)"
  local regex="$(cat "$run_dir/regex_suggestions.md" 2>/dev/null | head -c 80000 || true)"
  local facts="$(cat "$run_dir/facts_todo.md" 2>/dev/null | head -c 80000 || true)"
  local failures="$(cat "$run_dir/failures.csv" 2>/dev/null | head -c 80000 || true)"
  local status="$(cat "$run_dir/git_status.txt" 2>/dev/null | head -c 40000 || true)"

  cat > "$prompt_file" <<EOF
You are an expert software engineer improving a call-coaching system ("overlay-assistant").
You MUST be memoryless: rely ONLY on what is included in this prompt.
Return TWO outputs:
(A) A unified diff patch that can be applied with \`git apply\`.
(B) A file bundle as JSON with keys = file paths and values = full file contents (only for new files or full rewrites).

Hard rules:
- Do not change WebSocket protocol types unless you also update shared types and tests.
- Do not remove existing features.
- Prefer small, safe patches that reduce moment="unknown" and improve confidence bands.
- Keep privacy constraints: do not log raw transcript content beyond current behavior.
- Ensure builds pass: packages/shared, apps/server, apps/web.
- Add or update tests where easy.
- Focus on: moment detection coverage, tone handling, off-topic bridge quality, and cold-call decision-maker routing.

Repo signals:
- Unknown moment is high in stress tests (see artifacts).
- Your output MUST include: PATCH_START ... PATCH_END for the diff.
- And FILES_START ... FILES_END for the JSON bundle.

Artifacts:
[git_status]
$status

[overnight_report.md]
$report

[metrics.json]
$metrics

[top_terms_unknown.json]
$unknown

[regex_suggestions.md]
$regex

[facts_todo.md]
$facts

[failures.csv]
$failures
EOF

  # Call OpenAI Responses API (official)
  curl -sS https://api.openai.com/v1/responses \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d @- > "$response_file" <<JSON
{
  "model": "$MODEL",
  "instructions": "You generate high-quality code patches and files. Output must be structured exactly as requested.",
  "input": $(python3 - <<PY
import json,sys
print(json.dumps(open("$prompt_file","r",encoding="utf-8").read()))
PY
)
}
JSON

  # Extract output_text (best-effort)
  python3 - <<PY
import json,sys,re
p="$response_file"
j=json.load(open(p,"r",encoding="utf-8"))
text=j.get("output_text","") or ""
if not text:
  # fallback: try to find any output_text-like field
  text=str(j)
open("$run_dir/assistant_output.txt","w",encoding="utf-8").write(text)

m=re.search(r"PATCH_START\\s*(.*?)\\s*PATCH_END", text, re.S)
open("$patch_file","w",encoding="utf-8").write(m.group(1).strip()+"\\n" if m else "")

m2=re.search(r"FILES_START\\s*(.*?)\\s*FILES_END", text, re.S)
open("$run_dir/files_bundle.json","w",encoding="utf-8").write(m2.group(1).strip()+"\\n" if m2 else "{}")
PY
}

apply_patch_and_files() {
  local run_dir="$1"
  local patch_file="$run_dir/patch.diff"
  local bundle="$run_dir/files_bundle.json"

  if [[ -s "$patch_file" ]]; then
    echo "[finisher] applying patch..."
    git apply --3way "$patch_file" || (echo "[finisher] git apply failed"; exit 1)
  else
    echo "[finisher] no patch produced (empty)."
  fi

  echo "[finisher] applying file bundle..."
  python3 - <<PY
import json,os
bundle_path="$bundle"
try:
  data=json.load(open(bundle_path,"r",encoding="utf-8"))
except Exception:
  data={}
if not isinstance(data,dict):
  data={}
for fp,content in data.items():
  if not isinstance(fp,str) or not isinstance(content,str): 
    continue
  fp=fp.strip().lstrip("./")
  if not fp: 
    continue
  os.makedirs(os.path.dirname(fp) or ".", exist_ok=True)
  open(fp,"w",encoding="utf-8").write(content)
print(f"[finisher] wrote {len(data)} file(s) from bundle")
PY
}

for i in $(seq 1 "$ITERATIONS"); do
  RUNID="finisher_$(timestamp)_iter${i}"
  RUNDIR="$OUTROOT/$RUNID"
  mkdir -p "$RUNDIR"
  echo "=============================="
  echo "[finisher] iteration $i/$ITERATIONS  runDir=$RUNDIR"
  echo "=============================="

  git_snapshot "$RUNDIR"

  # Build first; if builds fail, still proceed (assistant can fix)
  (run_builds) || true

  run_harness "$RUNDIR"

  call_openai_for_patch "$RUNDIR"
  apply_patch_and_files "$RUNDIR"

  # Re-run builds; stop if broken
  run_builds

  git add -A
  git commit -m "finisher: auto improvements iter $i" || true
done

echo "[finisher] DONE. Outputs in $OUTROOT"
