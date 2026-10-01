// Throwaway: merge Meshy text-to-motion clips (ride/edge) into the library-clip GLB and rename clips.
import { NodeIO } from '/Users/amirimani/Desktop/work/kite-runner/node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS } from '/Users/amirimani/Desktop/work/kite-runner/node_modules/@gltf-transform/extensions/dist/index.js';
import { Matrix4, Vector3, Line3 } from '/Users/amirimani/Desktop/work/kite-runner/node_modules/three/build/three.module.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('/tmp/rider.lib.glb');
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));

const RENAME = { Regular_Jump: 'pop', Fall2: 'air', Jumping_Down: 'land', falling_down: 'fall', Swim_Idle: 'water_idle' };
for (const a of root.listAnimations()) a.setName(RENAME[a.getName()] ?? a.getName());

for (const clip of ['ride', 'edge']) {
  const src = await io.read(`/tmp/rider.${clip}.glb`);
  const anim = src.getRoot().listAnimations().find((a) => a.getName() === 'retarget_clip');
  const out = doc.createAnimation(clip);
  let missing = 0;
  for (const ch of anim.listChannels()) {
    const target = byName.get(ch.getTargetNode()?.getName());
    if (!target) { missing++; continue; }
    const s = ch.getSampler();
    const copy = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    out.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
  console.log(clip, 'channels', anim.listChannels().length, 'missing targets', missing);
}
console.log(root.listAnimations().map((a) => a.getName()));
// In-place clips: pin the Hips' horizontal root motion to the rest pose so the feet stay on the board.
const hips = byName.get('Hips');
const [hx, , hz] = hips.getTranslation();
for (const a of root.listAnimations()) {
  for (const ch of a.listChannels()) {
    if (ch.getTargetNode() !== hips || ch.getTargetPath() !== 'translation') continue;
    const out = ch.getSampler().getOutput();
    const v = out.getArray().slice();
    for (let i = 0; i < v.length; i += 3) { v[i] = hx; v[i + 2] = hz; }
    out.setArray(v);
  }
}
// Auto-rig was done with arms hanging beside the thighs, so hand vertices carry thigh weights (often
// as the dominant influence) and stay behind when the arms lift. For any vertex mixing arm and
// leg/hip weights, keep the group whose bones are geometrically closer in the bind pose.
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const ibm = skin.getInverseBindMatrices().getArray();
const jointPos = {};
joints.forEach((j, i) => { jointPos[j.getName()] = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(ibm, i * 16).invert()); });
const seg = (a, b) => new Line3(jointPos[a], jointPos[b]);
const tip = (side) => jointPos[`${side}Hand`].clone().add(jointPos[`${side}Hand`].clone().sub(jointPos[`${side}ForeArm`]).multiplyScalar(0.8));
const segs = {
  L: [seg('LeftArm', 'LeftForeArm'), seg('LeftForeArm', 'LeftHand'), new Line3(jointPos.LeftHand, tip('Left'))],
  R: [seg('RightArm', 'RightForeArm'), seg('RightForeArm', 'RightHand'), new Line3(jointPos.RightHand, tip('Right'))],
  leg: [seg('Hips', 'LeftUpLeg'), seg('Hips', 'RightUpLeg'), seg('LeftUpLeg', 'LeftLeg'), seg('RightUpLeg', 'RightLeg')],
};
const tmp = new Vector3();
const dist = (p, g) => Math.min(...segs[g].map((s) => s.closestPointToPoint(p, true, tmp).distanceTo(p)));
const group = joints.map((j) => {
  const n = j.getName();
  return /^Left(Arm|ForeArm|Hand)/.test(n) ? 'L' : /^Right(Arm|ForeArm|Hand)/.test(n) ? 'R' : /UpLeg|Leg|Foot|Toe|Hips/.test(n) ? 'leg' : 'torso';
});
let fixed = 0;
const p = new Vector3();
for (const prim of root.listMeshes().flatMap((m) => m.listPrimitives())) {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), P = prim.getAttribute('POSITION').getArray();
  const ja = J.getArray(), wa = W.getArray().slice();
  for (let i = 0, v = 0; i < wa.length; i += 4, v += 3) {
    const has = new Set();
    for (let k = 0; k < 4; k++) if (wa[i + k] > 0) has.add(group[ja[i + k]]);
    const arms = ['L', 'R'].filter((g) => has.has(g));
    if (!arms.length || (!has.has('leg') && arms.length < 2)) continue;
    p.fromArray(P, v);
    const keep = ['L', 'R', 'leg'].filter((g) => has.has(g)).reduce((a, b) => (dist(p, a) <= dist(p, b) ? a : b));
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const g = group[ja[i + k]];
      if (g !== keep && g !== 'torso') wa[i + k] = 0;
      total += wa[i + k];
    }
    for (let k = 0; k < 4; k++) wa[i + k] /= total;
    fixed++;
  }
  W.setArray(wa);
}
console.log('reweighted vertices', fixed);
await io.write('/tmp/rider.merged.glb', doc);
