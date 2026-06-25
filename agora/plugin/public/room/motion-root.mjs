const MIN_UPRIGHT_HIPS_Y = 0.5;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Kimodo's sourceRestHipsPosition is the first animation frame, not necessarily
// the source rig's upright rest height. Floor-to-stand clips therefore begin at
// ~0.1m and must use their upright final frame as the retargeting reference.
export function sourceUprightHipsY(motion) {
  const first = finiteNumber(motion?.sourceRestHipsPosition?.[1]);
  if (first !== null && Math.abs(first) >= MIN_UPRIGHT_HIPS_Y) return Math.abs(first);

  const positions = motion?.hipsPositions;
  const last = finiteNumber(positions?.[positions.length - 2]);
  if (last !== null && Math.abs(last) >= MIN_UPRIGHT_HIPS_Y) return Math.abs(last);

  // Kimodo motions use a roughly one-metre upright hip height. A floor-only
  // clip has no upright endpoint, so 1m prevents its small root motion from
  // being amplified by a near-zero first frame.
  return 1;
}

export function retargetHipsY(targetUprightY, sourceY, motion) {
  const target = finiteNumber(targetUprightY);
  const source = finiteNumber(sourceY);
  if (target === null || source === null) return target ?? 0;
  return source * target / sourceUprightHipsY(motion);
}

export function groundedSceneY(sceneY, contactY, groundY, minOffset = -0.18, maxOffset = 0.45) {
  const scene = finiteNumber(sceneY);
  const contact = finiteNumber(contactY);
  const ground = finiteNumber(groundY);
  if (scene === null || contact === null || ground === null) return scene ?? 0;
  return Math.max(minOffset, Math.min(maxOffset, scene + ground - contact));
}
