"""Agora connector — local Qwen3-TTS voice for the AI call feature.

Synthesizes an agent's reply to a WAV using the local qwentts.cpp engine, so the call
surface in the webapp can speak it. Two voice kinds:
  * built-in CustomVoice speakers (serena, vivian, …) — no reference files needed
  * cloned reference voices (qwen3:english/3_warm, …) — need voice_actors/<ref>.{wav,txt}

Setup is intentionally dead-simple: drop a `voice_actors.zip` next to this connector (or in
the qwen root) and we auto-extract it into <root>/voice_actors/ on first use. Everything else
falls back to env vars with sane defaults.

Env:
  AGORA_VOICE            "1" (default) to speak replies, "0" to disable
  AGORA_VOICE_ID         voice id (default "serena"); a built-in name or a qwen3:lang/ref clone
  AIKO_QWEN_TTS_ROOT     qwentts.cpp root (default ~/Project/qwen3-tts/qwen-tts-basic)
"""

import os
import glob
import zipfile
import subprocess
import tempfile

QWEN_ROOT = os.path.expanduser(
    os.environ.get("AIKO_QWEN_TTS_ROOT", "~/Project/qwen3-tts/qwen-tts-basic"))
VOICE_ENABLED = os.environ.get("AGORA_VOICE", "1") != "0"
DEFAULT_VOICE = os.environ.get("AGORA_VOICE_ID", "serena").strip()

BUILTIN_SPEAKERS = {
    "serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan",
}

_refs_ready = False


def _bin():
    return os.path.join(QWEN_ROOT, "build", "qwen-tts")


def _codec():
    return os.path.join(QWEN_ROOT, "models", "qwen-tokenizer-12hz-Q4_K_M.gguf")


def _talker(custom):
    name = "customvoice" if custom else "base"
    return os.path.join(QWEN_ROOT, "models", f"qwen-talker-0.6b-{name}-Q4_K_M.gguf")


def engine_ok():
    """True when the binary + tokenizer + at least one talker model are present."""
    return (os.path.exists(_bin()) and os.path.exists(_codec()) and
            (os.path.exists(_talker(True)) or os.path.exists(_talker(False))))


def ensure_refs():
    """One-time: if a voice_actors.zip was dropped near the connector or in the qwen root,
    extract it into <root>/voice_actors/. Lets the user 'splotch a zip locally' and be done."""
    global _refs_ready
    if _refs_ready:
        return
    _refs_ready = True
    dest = os.path.join(QWEN_ROOT, "voice_actors")
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "voice_actors.zip"),
        os.path.join(QWEN_ROOT, "voice_actors.zip"),
        os.path.expanduser("~/voice_actors.zip"),
    ]
    zpath = next((c for c in candidates if os.path.exists(c)), None)
    if not zpath:
        return
    try:
        os.makedirs(dest, exist_ok=True)
        with zipfile.ZipFile(zpath) as z:
            # tolerate a zip that wraps everything in a top-level voice_actors/ folder
            for m in z.namelist():
                if m.endswith("/"):
                    continue
                rel = m
                parts = m.split("/")
                if parts and parts[0] in ("voice_actors", "voice_actors.zip"):
                    rel = "/".join(parts[1:])
                if not rel:
                    continue
                target = os.path.join(dest, rel)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(m) as src, open(target, "wb") as out:
                    out.write(src.read())
        n = len(glob.glob(os.path.join(dest, "**", "*.wav"), recursive=True))
        print(f"[voice] extracted {zpath} -> {dest} ({n} reference wavs)", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[voice] could not extract {zpath}: {e}", flush=True)


def _is_chinese(text):
    return any("一" <= c <= "鿿" for c in text)


def synth(text, voice_id=None):
    """Synthesize `text` to a temp WAV path with the chosen voice, or None if unavailable."""
    if not VOICE_ENABLED or not text or not text.strip():
        return None
    if not engine_ok():
        return None
    ensure_refs()
    vid = (voice_id or DEFAULT_VOICE).strip()
    lang = "Chinese" if _is_chinese(text) else "English"
    out = tempfile.mktemp(suffix=".wav")

    if vid in BUILTIN_SPEAKERS:
        args = [_bin(), "--model", _talker(True), "--codec", _codec(),
                "--lang", lang, "--speaker", vid, "--format", "wav16", "-o", out]
    else:
        ref = vid.replace("qwen3:", "").replace("qwen:", "")
        ref_wav = os.path.join(QWEN_ROOT, "voice_actors", ref + ".wav")
        ref_txt = os.path.join(QWEN_ROOT, "voice_actors", ref + ".txt")
        if not os.path.exists(ref_wav) or not os.path.exists(ref_txt):
            print(f"[voice] missing reference for {vid} ({ref_wav}); skipping TTS", flush=True)
            return None
        args = [_bin(), "--model", _talker(False), "--codec", _codec(), "--lang", lang,
                "--ref-wav", ref_wav, "--ref-text", ref_txt, "--format", "wav16", "-o", out]

    try:
        # keep replies short enough for snappy CPU synth; the call reads the spoken text.
        clipped = text.strip()[:600]
        p = subprocess.run(args, input=clipped.encode("utf-8"),
                           capture_output=True, cwd=QWEN_ROOT, timeout=180)
        if p.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 1000:
            return out
        print(f"[voice] synth failed rc={p.returncode}: {p.stderr.decode('utf-8', 'ignore')[-200:]}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[voice] synth error: {e}", flush=True)
    return None
