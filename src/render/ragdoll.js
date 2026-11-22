// Draws a tumbling person (core/ragdoll.js) with the existing person
// mesh (render/personmesh.js): the whole mesh turns about the body
// centre and the limb bones take the ragdoll's loose limb angles. Also
// holds the settled lying pose afterwards. No three.js import: it only
// writes numbers into the mesh, so it is safe to load in node.
import { ragOrigin, LIMB, LIMB_REST, RAG_THICK } from '../core/ragdoll.js';

const O = { x: 0, y: 0, z: 0 };

// Returns true when it posed the mesh (the plain fall pose is skipped).
// Call after updatePersonMesh. The mesh uses rotation order 'YXZ'.
export function poseRagdoll(mesh, a) {
  if (!mesh || !a || !a.life || a.life === 'ok' || a.life === 'getup') return false;
  const s = a.rag;
  const live = !!(s && s.on && s.actor === a);
  if (!live && !a.ragDone) return false;
  let yaw, pitch, roll, cy, ang;
  if (live) {
    yaw = s.yaw;
    pitch = s.pitch;
    roll = s.roll;
    cy = s.y;
    ang = s.ang;
  } else {
    yaw = a.ragYaw || 0;
    pitch = a.ragPitch || 0;
    roll = a.ragRoll || 0;
    cy = (a.y || 0) + RAG_THICK;
    ang = LIMB_REST;
  }
  // updatePersonMesh placed the mesh at the (interpolated) actor x, z,
  // which is the body centre while ragdolled.
  const cx = mesh.position.x, cz = mesh.position.z;
  ragOrigin(cx, cy, cz, yaw, pitch, roll, O);
  if (mesh.rotation.order !== 'YXZ') mesh.rotation.order = 'YXZ';
  mesh.rotation.set(roll, -yaw, pitch);
  mesh.position.set(O.x, O.y - (a.fade || 0) * 0.5, O.z);
  mesh.visible = !(a.fade >= 1);
  const P = mesh.userData && mesh.userData.person;
  if (P) {
    P.armL.rotation.x = ang[LIMB.armLx];
    P.armR.rotation.x = ang[LIMB.armRx];
    P.armL.rotation.z = ang[LIMB.armLz];
    P.armR.rotation.z = ang[LIMB.armRz];
    P.legL.rotation.x = ang[LIMB.legLx];
    P.legR.rotation.x = ang[LIMB.legRx];
    P.legL.rotation.z = ang[LIMB.legLz];
    P.legR.rotation.z = ang[LIMB.legRz];
    P.head.rotation.z = ang[LIMB.head];
    const b = ang[LIMB.bend];
    P.elbowL.rotation.z = 0.2 + b;
    P.elbowR.rotation.z = 0.1 + b * 0.7;
    P.kneeL.rotation.z = -b;
    P.kneeR.rotation.z = -b * 0.4;
    P.torso.rotation.z = 0;
    P.body.position.y = 0;
  }
  return true;
}
