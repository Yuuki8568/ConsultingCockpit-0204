#!/usr/bin/env python3
"""Local-only Japanese transcription; first-time model setup is separate."""
import argparse, hashlib, json, os, sys, time
from pathlib import Path
MODEL_REPO = 'Systran/faster-whisper-medium'
MODEL_REV = '08e178d48790749d25932bbc082711ddcfdfbc4f'
MODEL_SHA256 = '9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae'
MODEL_FILES = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']
MAX_SECONDS = 10800
RATE = 16000
DEFAULT_MODEL = Path.home() / 'Library/Application Support/CockpitLocalTranscriber/model-medium'

def validate_model(model_dir):
    if not all((model_dir / f).is_file() for f in MODEL_FILES):
        raise ValueError('初回準備が必要です。Setup.commandを実行してください。')
    with (model_dir / 'model.bin').open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != MODEL_SHA256:
        raise ValueError('精密モデルの内容が一致しません。Setup.commandで準備し直してください。')


def decode(path):
    import av
    import numpy as np
    if path.stat().st_size > 4 * 1024**3:
        raise ValueError('4 GiBを超えるファイルです。分割してください。')
    chunks, count = [], 0
    # Decode audio only. No shell invocation, network URL or media upload.
    with av.open(str(path), options={'protocol_whitelist': 'file,pipe'}) as container:
        if not container.streams.audio:
            raise ValueError('音声トラックがありません。')
        resampler = av.AudioResampler(format='s16', layout='mono', rate=RATE)
        def collect(frame):
            nonlocal count
            a = frame.to_ndarray().reshape(-1).copy()
            count += a.size
            if count > MAX_SECONDS * RATE:
                raise ValueError('3時間を超える音声です。分割してください。')
            chunks.append(a)
        for frame in container.decode(container.streams.audio[0]):
            for out in resampler.resample(frame):
                collect(out)
        for out in resampler.resample(None):
            collect(out)
    if not count:
        raise ValueError('読み取れる音声がありません。')
    # PCM16 chunks + float32 output; input duration is capped to bound memory.
    audio = np.empty(count, dtype=np.float32)
    offset = 0
    for a in chunks:
        audio[offset:offset+a.size] = a / np.float32(32768)
        offset += a.size
    return audio

def prepare_source(source, folder):
    """Video: persist audio-only WAV. Audio: bypass the extraction file."""
    import av, wave
    if source.stat().st_size > 4 * 1024**3:
        raise ValueError('4 GiBを超えるファイルです。')
    with av.open(str(source), options={'protocol_whitelist': 'file,pipe'}) as container:
        if not container.streams.audio:
            raise ValueError('音声トラックがありません。')
        if not container.streams.video or source.suffix.lower() in {'.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.opus', '.aiff'}:
            return source, 'audio'
        target = folder / 'extracted-audio.wav'
        count = 0
        try:
            with wave.open(str(target), 'wb') as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(RATE)
                resampler = av.AudioResampler(format='s16', layout='mono', rate=RATE)
                def write(frame):
                    nonlocal count
                    count += frame.samples
                    if count > MAX_SECONDS * RATE:
                        raise ValueError('3時間を超える音声です。分割してください。')
                    output.writeframesraw(frame.to_ndarray().astype('<i2', copy=False).tobytes())
                for frame in container.decode(container.streams.audio[0]):
                    for converted in resampler.resample(frame): write(converted)
                for converted in resampler.resample(None): write(converted)
            if not count: raise ValueError('音声がありません。')
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    return target, 'video'


def setup(model_dir):
    repo, revision = MODEL_REPO, MODEL_REV
    from huggingface_hub import snapshot_download
    model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo, revision=revision, allow_patterns=MODEL_FILES,
                      local_dir=str(model_dir))
    validate_model(model_dir)
    print('モデル準備完了。次回からオフラインで処理できます。', flush=True)

def run(source, destination, terms, model_dir, threads):
    repo, revision = MODEL_REPO, MODEL_REV
    if not source.is_file():
        raise ValueError('端末内のファイルを指定してください。')
    if len(terms) > 500:
        raise ValueError('認識用語は500文字以内にしてください。')
    validate_model(model_dir)
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    from faster_whisper import WhisperModel
    started = time.monotonic()
    destination.mkdir(parents=True, exist_ok=True)
    # Unique directory: never replace a previous transcript.
    import tempfile
    folder = Path(tempfile.mkdtemp(prefix='transcription-', dir=destination))
    os.chmod(folder, 0o700)
    metadata = {'status': 'running', 'durationSeconds': None, 'stage': 'preparing', 'model': repo,
                'revision': revision, 'threads': threads, 'terms': terms,
                'sourceName': source.name, 'reviewRequired': True, 'resumeSupported': False}
    def save_status(status):
        metadata['status'] = status
        metadata['wallSeconds'] = time.monotonic() - started
        temp = folder / 'status.tmp'
        temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(folder / 'status.json')
    save_status('running')
    print('保存先: ' + str(folder), flush=True)
    rows = []
    try:
        print('入力を確認し、動画の場合は音声ファイルを抽出します…', flush=True)
        prepared, kind = prepare_source(source, folder)
        metadata.update(sourceKind=kind, extractedAudio='extracted-audio.wav' if kind == 'video' else None, stage='transcribing')
        audio = decode(prepared)
        duration = len(audio) / RATE
        metadata['durationSeconds'] = duration
        save_status('running')
        model = WhisperModel(str(model_dir), device='cpu', compute_type='int8', cpu_threads=threads, local_files_only=True)
        segments, _ = model.transcribe(audio, language='ja', beam_size=5,
            condition_on_previous_text=False, no_speech_threshold=None, vad_filter=False,
            initial_prompt=terms or None, hotwords=terms or None)
        with (folder/'transcript.txt').open('w', encoding='utf-8') as text, (folder/'segments.jsonl').open('w', encoding='utf-8') as detail:
            for s in segments:
                row = {'start': min(duration, max(0, s.start)), 'end': min(duration, s.end), 'text': s.text}
                rows.append(row)
                text.write(s.text.strip() + '\n'); text.flush(); os.fsync(text.fileno())
                detail.write(json.dumps(row, ensure_ascii=False) + '\n'); detail.flush(); os.fsync(detail.fileno())
                metadata['processedSeconds'] = min(s.end, duration)
                save_status('running')
                print(f'{min(s.end,duration):.0f} / {duration:.0f} 秒まで保存', flush=True)
        from review_page import write_review
        write_review(folder, source.name, rows)
        save_status('done')
    except KeyboardInterrupt:
        save_status('cancelled'); print('中止しました。保存済み部分は残しています。', flush=True)
        return 130
    except Exception:
        save_status('error'); raise
    print('完了。誤変換・数字・否定表現・抜けを原音と確認してください。', flush=True)
    return 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--setup', action='store_true')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--terms', default='')
    parser.add_argument('--threads', type=int, choices=range(1,9), default=4)
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()
    os.umask(0o077)
    if args.setup:
        setup(args.model); return 0
    if not args.input: parser.error('--input is required; use Transcribe.command for file selection')
    if not args.output: parser.error('--output is required with --input')
    return run(args.input, args.output, args.terms, args.model, args.threads)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('処理できませんでした: ' + str(exc), file=sys.stderr)
        sys.exit(1)
