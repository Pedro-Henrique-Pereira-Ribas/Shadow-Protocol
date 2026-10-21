// Entrada: teclado, mouse, pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // acoes de um unico frame
    this.mouseDX = 0;
    this.mouseDown = false;
    this.mouseClicked = false;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = false;
    this.onLockChange = null;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (['Tab', 'Space', 'F1', 'F5'].includes(code) && this.locked) e.preventDefault();
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = false; this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY = (this.mouseDY || 0) + (e.movementY || 0);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseDown = true; this.mouseClicked = true; }
      if (e.button === 2) this.pressed.add('MouseRight');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel = (this.wheel || 0) + Math.sign(e.deltaY);
    }, { passive: false });
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  exitLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  axis() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  consumeMouse() {
    const dx = this.mouseDX;
    this.mouseDX = 0;
    return dx;
  }
  consumeWheel() {
    const w = this.wheel || 0;
    this.wheel = 0;
    return w;
  }
  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
  }
}
