#!/usr/bin/env bash
# Pre-generate a real Qwen3-TTS preview clip for each picker voice. Output goes to the webapp
# source (src/voice-samples/<safe-id>.wav, served at /static/voice-samples/) so the Voice picker's
# ▶ Test plays the REAL voice — no browser TTS. Run after dropping voice_actors.zip (auto-extracted
# by the connector's voice.py, or extract it yourself into <root>/voice_actors/).
#
#   AIKO_QWEN_TTS_ROOT=~/Project/qwen3-tts/qwen-tts-basic bash gen_voice_samples.sh
set -uo pipefail

ROOT="${AIKO_QWEN_TTS_ROOT:-$HOME/Project/qwen3-tts/qwen-tts-basic}"
OUT="${AGORA_SAMPLES_OUT:-/mnt/c/Users/xiang/claude-workspace/references/mattermost/webapp/channels/src/voice-samples}"
BIN="$ROOT/build/qwen-tts"
TALKER="$ROOT/models/qwen-talker-0.6b-base-Q4_K_M.gguf"
CODEC="$ROOT/models/qwen-tokenizer-12hz-Q4_K_M.gguf"
LINE_EN="Hi, I'm your Agora agent. This is how I sound on a call."
LINE_ZH="你好，我是你的 Agora 助手，这就是我在通话里的声音。"

mkdir -p "$OUT"
[ -x "$BIN" ] || { echo "no qwen-tts binary at $BIN — build the engine first"; exit 1; }

# id | ref folder | lang  (must match webapp src/components/agora/voices.ts QWEN_VOICES)
read -r -d '' VOICES <<'EOF'
qwen3:english/0_intro|english/0_intro|English
qwen3:english/1_window|english/1_window|English
qwen3:english/2_amateur|english/2_amateur|English
qwen3:english/3_warm|english/3_warm|English
qwen3:english/4_classically_trained|english/4_classically_trained|English
qwen3:english/5_monotone|english/5_monotone|English
qwen3:english/6_dramatic|english/6_dramatic|English
qwen3:english/7_juilliard|english/7_juilliard|English
qwen3:english/12_hutao|english/12_hutao|English
qwen3:english/13_emilia|english/13_emilia|English
qwen3:english/14_rem|english/14_rem|English
qwen3:english/15_soothing_woman|english/15_soothing_woman|English
qwen3:english/16_confident_male|english/16_confident_male|English
qwen3:english/17_powerful_male|english/17_powerful_male|English
qwen3:english/18_powerful_female|english/18_powerful_female|English
qwen3:english/19_male_mc|english/19_male_mc|English
qwen3:english/20_stuttering_male|english/20_stuttering_male|English
qwen3:chinese/8_cute_chinese|chinese/8_cute_chinese|Chinese
qwen3:chinese/9_hutao|chinese/9_hutao|Chinese
qwen3:chinese/10_ganyu|chinese/10_ganyu|Chinese
qwen3:chinese/11_xiangling|chinese/11_xiangling|Chinese
EOF

n=0; ok=0
while IFS='|' read -r id ref lang; do
    [ -z "${id:-}" ] && continue
    n=$((n + 1))
    rw="$ROOT/voice_actors/$ref.wav"
    rt="$ROOT/voice_actors/$ref.txt"
    if [ ! -f "$rw" ] || [ ! -f "$rt" ]; then
        echo "SKIP $id — missing ref ($rw)"
        continue
    fi
    safe="$(printf '%s' "$id" | sed 's#[:/]#_#g')"
    out="$OUT/$safe.wav"
    line="$LINE_EN"; [ "$lang" = "Chinese" ] && line="$LINE_ZH"
    printf '[gen %2d] %s -> %s.wav ... ' "$n" "$id" "$safe"
    if printf '%s' "$line" | "$BIN" --model "$TALKER" --codec "$CODEC" --lang "$lang" \
        --ref-wav "$rw" --ref-text "$rt" --format wav16 -o "$out" >/dev/null 2>&1 && [ -s "$out" ]; then
        echo "ok ($(stat -c%s "$out") bytes)"
        ok=$((ok + 1))
    else
        echo "FAILED"
    fi
done <<< "$VOICES"

echo "DONE: $ok/$n samples in $OUT"
