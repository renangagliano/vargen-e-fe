import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MediaMetadata } from "../shared/types.js";

const execFileAsync = promisify(execFile);

type FFprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  display_aspect_ratio?: string;
  sample_aspect_ratio?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  channels?: number;
  sample_rate?: string;
  bit_rate?: string;
};

type FFprobeOutput = {
  format?: { format_name?: string; duration?: string; bit_rate?: string };
  streams?: FFprobeStream[];
};

function numberOrNull(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function frameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) return numerator / denominator;
  return numberOrNull(value);
}

export async function probeMedia(ffprobePath: string, sourcePath: string): Promise<MediaMetadata> {
  const result = await execFileAsync(ffprobePath, [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    sourcePath,
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

  const parsed = JSON.parse(String(result.stdout)) as FFprobeOutput;
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");

  return {
    durationMs: numberOrNull(parsed.format?.duration) === null ? null : Math.round((numberOrNull(parsed.format?.duration) as number) * 1000),
    width: video?.width ?? null,
    height: video?.height ?? null,
    displayAspectRatio: video?.display_aspect_ratio ?? null,
    sampleAspectRatio: video?.sample_aspect_ratio ?? null,
    frameRate: frameRate(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioChannels: audio?.channels ?? null,
    audioSampleRate: numberOrNull(audio?.sample_rate),
    bitrate: numberOrNull(parsed.format?.bit_rate),
    container: parsed.format?.format_name ?? null,
  };
}
