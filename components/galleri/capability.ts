export type RoomSupport = 'ok' | 'weak' | 'none';

interface NavigatorHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function createProbeContext(failOnSoftware: boolean) {
  return document.createElement('canvas').getContext('webgl2', {
    failIfMajorPerformanceCaveat: failOnSoftware,
  });
}

function release(context: WebGL2RenderingContext) {
  context.getExtension('WEBGL_lose_context')?.loseContext();
}

/** Decides whether to open the 3D room, or show the list first and leave the choice to the visitor. */
export function detectRoomSupport(): RoomSupport {
  const anyContext = createProbeContext(false);
  if (!anyContext) return 'none';
  release(anyContext);

  const hints = navigator as Navigator & NavigatorHints;
  if (hints.connection?.saveData) return 'weak';
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) return 'weak';
  if (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2) return 'weak';

  const hardwareContext = createProbeContext(true);
  if (!hardwareContext) return 'weak';
  release(hardwareContext);
  return 'ok';
}
