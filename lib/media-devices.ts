type VideoConstraint = boolean | MediaTrackConstraints;

function compactConstraints(values: Array<VideoConstraint | null | undefined>) {
  return values.filter((value): value is VideoConstraint => Boolean(value));
}

const VIDEO_CONSTRAINTS = compactConstraints([
  {
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 24, max: 30 }
  },
  true
]);

export async function getCallMedia(mode: "audio" | "video") {
  if (mode === "audio") {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      effectiveMode: "audio" as const
    };
  }

  try {
    const stream = await getAudioVideoStream();
    return { stream, effectiveMode: "video" as const };
  } catch {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      effectiveMode: "audio" as const
    };
  }
}

async function getAudioVideoStream() {
  let lastError: unknown = null;
  for (const video of VIDEO_CONSTRAINTS) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not open camera and microphone.");
}

export async function getVideoStream() {
  let lastError: unknown = null;
  for (const video of VIDEO_CONSTRAINTS) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not open camera.");
}
