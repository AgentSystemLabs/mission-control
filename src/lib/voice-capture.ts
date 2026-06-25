// Renderer-side microphone capture for voice control. Records mono audio while
// push-to-talk is held, then encodes it to a 16 kHz 16-bit WAV buffer — the
// format whisper.cpp expects — so the main process can transcribe it offline.

const TARGET_SAMPLE_RATE = 16_000;

export type VoiceRecording = {
  /** Stop capture and return the audio as a 16 kHz mono 16-bit WAV. */
  stop: () => Promise<ArrayBuffer>;
  /** Discard the recording without producing audio. */
  cancel: () => void;
};

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!ctor) throw new Error("Web Audio API is not available");
  return ctor;
}

export async function startRecording(): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctx = getAudioContextCtor();
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (e) => {
    // Copy: the underlying buffer is reused across callbacks.
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  let torndown = false;
  const teardown = () => {
    if (torndown) return;
    torndown = true;
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      source.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const track of stream.getTracks()) track.stop();
    void ctx.close().catch(() => undefined);
  };

  return {
    async stop() {
      const sampleRate = ctx.sampleRate;
      teardown();
      const merged = mergeChunks(chunks);
      const downsampled = downsample(merged, sampleRate, TARGET_SAMPLE_RATE);
      return encodeWav(downsampled, TARGET_SAMPLE_RATE);
    },
    cancel() {
      chunks.length = 0;
      teardown();
    },
  };
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Linear-interpolation downsample. Capture is usually 44.1/48 kHz; whisper wants
// 16 kHz. Returns the input unchanged when it's already at/below the target.
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

// 16-bit PCM mono WAV. Pure function — unit-testable.
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
