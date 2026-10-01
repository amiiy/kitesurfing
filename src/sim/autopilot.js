import { MathUtils, Vector3 } from 'three';
import { AUTOPILOT, KITE } from '../config.js';
import { windowPoint } from './physics.js';

// The kite flies itself through the normal steering input: parked on the window edge at 10/2 o'clock
// on the side of travel, sent up the edge toward 12 o'clock as the jump loads and held there in the
// air, then eased back to the park spot as the rider drops from the apex.

const aim = new Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Clock angle on the window edge the kite is flown to: 0 = 12 o'clock.
function targetClock(s, jump) {
  const park = KITE.park * (Math.sign(s.forward.x) || 1);
  if (s.airborne) return park * MathUtils.clamp(-s.vel.y / AUTOPILOT.returnSpeed, 0, 1);
  return jump ? park * Math.max(0, 1 - s.charge / AUTOPILOT.sendCharge) : park;
}

function kiteSteer(s, jump) {
  const { kite } = s;
  // Aim past the edge, a fixed flying time beyond it: the kite flies onto the edge there and stays,
  // nose out into the wind, and a faster kite starts turning out earlier so it never overshoots.
  windowPoint(KITE.edge + (kite.speed * AUTOPILOT.aimTime) / KITE.lineLength, targetClock(s, jump), aim);
  // Great-circle bearing to the aim point: its components along the window's up and right at the kite.
  const { az, el } = kite;
  const up = -Math.sin(az) * Math.sin(el) * aim.x + Math.cos(el) * aim.y + Math.cos(az) * Math.sin(el) * aim.z;
  const right = Math.cos(az) * aim.x + Math.sin(az) * aim.z;
  const bearing = Math.atan2(right, up);
  // Turn the short way, but a low kite always turns through up: turning through down would fly it into the water.
  const error = kite.el < AUTOPILOT.lowElevation ? wrap(bearing) - wrap(kite.heading) : wrap(bearing - kite.heading);
  // Turn rate wanted, less the turn already under way, as steering at this airspeed (critically damped).
  const turn = AUTOPILOT.turnGain * error - AUTOPILOT.turnDamping * kite.turn;
  return MathUtils.clamp((turn * KITE.turnRadius) / Math.max(kite.speed, 1), -1, 1);
}

export function autopilot(s, jump) {
  return { kiteSteer: kiteSteer(s, jump), jump };
}
