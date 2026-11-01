import { Input, BlobSource, AudioBufferSink, MP3, MP4, WAVE, WEBM, OGG, FLAC, MATROSKA, QTFF, ADTS } from 'mediabunny';
import { SAMPLE_RATE, validateMedia, WINDOW_SECONDS, CONTEXT_SECONDS } from './limits';

/** Seek/read only a bounded audio interval. Video pixels are never decoded. */
export async function openAudio(blob: Blob, signal: AbortSignal) {
  const input = new Input({ source: new BlobSource(blob, { maxCacheSize: 8 * 1024 * 1024 }), formats: [MP3, MP4, WAVE, WEBM, OGG, FLAC, MATROSKA, QTFF, ADTS] });
  const close = () => input.dispose();
  signal.addEventListener('abort', close, { once: true });
  const dispose = () => { signal.removeEventListener('abort', close); close(); };
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw new Error('音声がないか、このブラウザで読み込めない形式です。MP3・WAVなどでお試しください。');
    const first = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - first;
    validateMedia(blob.size, duration);
    const sampleRate = await track.getSampleRate();
    if (!sampleRate || sampleRate > 192000) throw new Error('192kHz以下の音声に変換してください。');
    const sink = new AudioBufferSink(track);
    return { duration, dispose, async read(from: number, to: number): Promise<Float32Array> {
      signal.throwIfAborted();
      if (to - from > WINDOW_SECONDS + CONTEXT_SECONDS * 2 + 0.01) throw new Error('音声区間が長すぎます');
      const mono = new Float32Array(Math.ceil((to - from) * sampleRate));
      try {
        for await (const { buffer, timestamp } of sink.buffers(first + from, first + to)) {
          signal.throwIfAborted();
          if (buffer.sampleRate !== sampleRate) throw new Error('途中で音声形式が変わるファイルには対応していません');
          const offset = Math.round((timestamp - first - from) * sampleRate);
          const low = Math.max(0, -offset), high = Math.min(buffer.length, mono.length - offset);
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const values = buffer.getChannelData(ch);
            for (let i = low; i < high; i++) mono[offset + i] += values[i] / buffer.numberOfChannels;
          }
        }
        signal.throwIfAborted();
        const ctx = new OfflineAudioContext(1, Math.ceil((to - from) * SAMPLE_RATE), SAMPLE_RATE);
        const buffer = ctx.createBuffer(1, mono.length, sampleRate);
        buffer.copyToChannel(mono, 0);
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination); source.start();
        const rendered = await ctx.startRendering();
        signal.throwIfAborted();
        return rendered.getChannelData(0);
      } finally { mono.fill(0); }
    } };
  } catch (error) { dispose(); throw error; }
}
