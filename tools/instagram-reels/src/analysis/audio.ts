import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MediaAnalysisReport, AudioEnergySample } from "../shared/types.js";

const execFileAsync = promisify(execFile);

type RawSample = { timeMs: number; rmsDb: number };

function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function parseRmsSamples(stderr: string): RawSample[] {
  const samples: RawSample[] = [];
  let pendingTimeMs: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const timeMatch = /pts_time[:=](-?\d+(?:\.\d+)?)/.exec(line);
    if (timeMatch) pendingTimeMs = Math.max(0, Math.round(Number(timeMatch[1]) * 1000));
    const rmsMatch = /lavfi\.astats\.Overall\.RMS_level=(-?\d+(?:\.\d+)?)/.exec(line);
    if (rmsMatch && pendingTimeMs !== null) {
      const rmsDb = Number(rmsMatch[1]);
      if (Number.isFinite(rmsDb)) samples.push({ timeMs: pendingTimeMs, rmsDb });
      pendingTimeMs = null;
    }
  }
  return samples;
}

async function analyzeAudio(ffmpegPath: string, sourcePath: string): Promise<RawSample[]> {
  const result = await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "info", "-i", sourcePath, "-vn",
    "-af", "asetnsamples=n=22050:pad=1,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", nullDevice(),
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return parseRmsSamples(String(result.stderr));
}

async function analyzeScenes(ffmpegPath: string, sourcePath: string): Promise<number> {
  try {
    const result = await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "info", "-i", sourcePath,
      "-vf", "select=gt(scene\\,0.35),showinfo", "-an", "-f", "null", nullDevice(),
    ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return (String(result.stderr).match(/showinfo.*pts_time:/g) ?? []).length;
  } catch {
    return 0;
  }
}

function normalizeSamples(raw: RawSample[]): { samples: AudioEnergySample[]; min: number | null; max: number | null; silence: number } {
  if (raw.length === 0) return { samples: [], min: null, max: null, silence: 0 };
  const values = raw.map((sample) => sample.rmsDb).sort((a, b) => a - b);
  const low = values[Math.floor(values.length * 0.05)] ?? values[0];
  const high = values[Math.floor(values.length * 0.95)] ?? values.at(-1) ?? values[0];
  const range = Math.max(1, high - low);
  const samples = raw.map((sample) => ({
    timeMs: sample.timeMs,
    rmsDb: Math.round(sample.rmsDb * 100) / 100,
    normalizedEnergy: Math.max(0, Math.min(1, (sample.rmsDb - low) / range)),
  }));
  return { samples, min: Math.min(...raw.map((sample) => sample.rmsDb)), max: Math.max(...raw.map((sample) => sample.rmsDb)), silence: raw.filter((sample) => sample.rmsDb <= -55).length };
}

export async function analyzeMedia(ffmpegPath: string, sourcePath: string, sourceAssetId: string, durationMs: number): Promise<MediaAnalysisReport> {
  const raw = await analyzeAudio(ffmpegPath, sourcePath);
  const normalized = normalizeSamples(raw);
  return {
    sourceAssetId,
    durationMs,
    audioSampleCount: normalized.samples.length,
    audioEnergyMinDb: normalized.min,
    audioEnergyMaxDb: normalized.max,
    silenceSampleCount: normalized.silence,
    sceneChangeCount: await analyzeScenes(ffmpegPath, sourcePath),
    lyricsSynchronized: false,
    samples: normalized.samples,
  };
}
