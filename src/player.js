// The human player: a Fighter whose intent comes from the keyboard and camera.
import { Fighter } from './fighter.js?v=s4r1';
import { cameraRelativeMove } from './character.js?v=s4r1';
import { ACTION } from './input.js?v=s4r1';

export class Player extends Fighter {
  constructor({ THREE, physics, scene, config }) {
    super({
      THREE, physics, scene, config, color: config.color, spawn: config.spawn,
      index: 0, kind: 'player', name: 'You',
    });
    this._intent = { moveX: 0, moveZ: 0, jump: false, left: false, right: false, faceYaw: null };
  }

  /** Reads input and updates the fighter. Call once per frame while the game is running. */
  update(dt, input, cameraYaw) {
    const forward = input.getAxis(ACTION.MOVE_BACK, ACTION.MOVE_FORWARD);
    const right = input.getAxis(ACTION.MOVE_LEFT, ACTION.MOVE_RIGHT);
    const m = cameraRelativeMove(cameraYaw, forward, right);
    const it = this._intent;
    it.moveX = m.x;
    it.moveZ = m.z;
    it.jump = input.wasPressed(ACTION.JUMP);
    it.left = input.isDown(ACTION.LEFT_HAND);
    it.right = input.isDown(ACTION.RIGHT_HAND);

    this.applyAimAssist(it);
    super.update(dt, it);
  }
}
