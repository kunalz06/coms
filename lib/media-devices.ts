export type CameraFacing = "user" | "environment";

type VideoConstraint = boolean | MediaTrackConstraints;

const CAMERA_LABELS: Record<CameraFacing, RegExp> = {
  user: /front|user|face|selfie/i,
  environment: /back|rear|environment|world/i
};

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

async function videoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices.filter((device) => device.kind === "videoinput");
}

function compactConstraints(values: Array<VideoConstraint | null | undefined>) {
  return values.filter((value): value is VideoConstraint => Boolean(value));
}

export async function getCallMedia(mode: "audio" | "video", facing: CameraFacing) {
  if (mode === "audio") {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      effectiveMode: "audio" as const
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 24, max: 30 }
      }
    });
    return { stream, effectiveMode: "video" as const };
  } catch {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      effectiveMode: "audio" as const
    };
  }
}

export async function getVideoStreamForFacing(facing: CameraFacing, options?: { avoidDeviceId?: string; requireDifferentDevice?: boolean }) {
  const devices = await videoDevices();
  const alternateDevice = options?.avoidDeviceId ? devices.find((device) => device.deviceId !== options.avoidDeviceId) : null;
  const labeledDevice = devices.find((device) => device.deviceId !== options?.avoidDeviceId && CAMERA_LABELS[facing].test(device.label));

  const constraints = compactConstraints([
    labeledDevice ? { deviceId: { exact: labeledDevice.deviceId } } : null,
    { facingMode: { exact: facing } },
    alternateDevice ? { deviceId: { exact: alternateDevice.deviceId } } : null,
    {
      facingMode: { ideal: facing },
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 24, max: 30 }
    },
    true
  ]);

  let lastError: unknown = null;
  for (const video of constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      const [track] = stream.getVideoTracks();
      const settings = track?.getSettings();
      const deviceId = settings?.deviceId;
      const trackFacingMode = settings?.facingMode;
      if (options?.requireDifferentDevice && options.avoidDeviceId && deviceId && deviceId === options.avoidDeviceId) {
        if (trackFacingMode === facing) return stream;
        stopStream(stream);
        continue;
      }
      return stream;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not open camera.");
}
