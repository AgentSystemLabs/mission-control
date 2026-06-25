import { describe, expect, it } from "vitest";
import { downsample, encodeWav } from "../voice-capture";

function readString(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav", () => {
  it("writes a valid 16 kHz mono 16-bit PCM WAV header", () => {
    const buffer = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + 4 * 2);
    expect(readString(view, 0, 4)).toBe("RIFF");
    expect(readString(view, 8, 4)).toBe("WAVE");
    expect(readString(view, 12, 4)).toBe("fmt ");
    expect(readString(view, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(8); // data size
  });

  it("clamps and scales samples to int16", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1]), 16_000));
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767); // +1.0 → max
    expect(view.getInt16(48, true)).toBe(-32768); // -1.0 → min
  });
});

describe("downsample", () => {
  it("halves the rate by picking every other sample", () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(downsample(input, 32_000, 16_000))).toEqual([0, 2, 4, 6]);
  });

  it("returns the input unchanged when already at or below the target rate", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(downsample(input, 16_000, 16_000)).toBe(input);
    expect(downsample(input, 8_000, 16_000)).toBe(input);
  });
});
