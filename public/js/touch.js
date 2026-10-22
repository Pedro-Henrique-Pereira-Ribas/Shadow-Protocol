// Controles touch para celular: joystick virtual, olhar por arrasto e botoes.
export class TouchControls {
  constructor(input, host, onPause = null) {
    this.input = input;
    this.host = host;
    this.onPause = onPause;
    this.enabled = false;
    this.movePointer = null;   // id do ponteiro no joystick
    this.lookPointer = null;   // id do ponteiro na zona de olhar
    this.lookLast = { x: 0, y: 0 };
    this.joyOrigin = { x: 0, y: 0 };
    this.build();
  }

  build() {
    const el = document.createElement('div');
    el.id = 'touch-ui';
    el.className = 'touch-ui hidden';
    el.innerHTML = `
      <div class="t-look-hint" id="tLookHint">ARRASTE PARA OLHAR</div>
      <div class="t-joy" id="tJoy">
        <div class="t-joy-base"></div>
        <div class="t-joy-knob" id="tJoyKnob"></div>
      </div>
      <div class="t-buttons">
        <button class="t-btn t-reload" id="tReload">RECARGA</button>
        <button class="t-btn t-crouch" id="tCrouch">AGACHAR</button>
        <button class="t-btn t-swap" id="tSwap">ARMA</button>
        <button class="t-btn t-pause" id="tPause">PAUSA</button>
      </div>
      <button class="t-fire" id="tFire">FOGO</button>`;
    this.host.appendChild(el);
    this.el = el;
    this.joy = el.querySelector('#tJoy');
    this.knob = el.querySelector('#tJoyKnob');
    this.fireBtn = el.querySelector('#tFire');
    this.reloadBtn = el.querySelector('#tReload');
    this.crouchBtn = el.querySelector('#tCrouch');
    this.swapBtn = el.querySelector('#tSwap');
    this.pauseBtn = el.querySelector('#tPause');
    this.hint = el.querySelector('#tLookHint');
    this.bind();
  }

  show(on) {
    this.enabled = on;
    this.el.classList.toggle('hidden', !on);
    if (!on) this.input.setTouchAxis(0, 0);
  }

  bind() {
    const canvas = this.input.canvas;

    // ---------- joystick (metade esquerda) ----------
    const joyStart = (e) => {
      if (this.movePointer !== null) return;
      this.movePointer = e.pointerId;
      const r = this.joy.getBoundingClientRect();
      this.joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.joy.style.left = `${this.joyOrigin.x - r.width / 2}px`;
      this.joy.style.top = `${this.joyOrigin.y - r.height / 2}px`;
      this.joy.classList.add('active');
      canvas.setPointerCapture?.(e.pointerId);
      this.joyMove(e);
      e.preventDefault();
    };
    const joyMove = (e) => {
      if (this.movePointer !== e.pointerId) return;
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const max = 52;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, max);
      const nx = (dx / len) * cl, ny = (dy / len) * cl;
      this.knob.style.transform = `translate(${nx}px, ${ny}px)`;
      this.input.setTouchAxis(nx / max, ny / max);
      e.preventDefault();
    };
    const joyEnd = (e) => {
      if (this.movePointer !== e.pointerId) return;
      this.movePointer = null;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.input.setTouchAxis(0, 0);
    };

    this.joy.addEventListener('pointerdown', joyStart);
    this.joy.addEventListener('pointermove', joyMove);
    this.joy.addEventListener('pointerup', joyEnd);
    this.joy.addEventListener('pointercancel', joyEnd);

    // ---------- olhar (arrastar na metade direita do canvas) ----------
    const lookStart = (e) => {
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
      this.hideHint();
      e.preventDefault();
    };
    const lookMove = (e) => {
      if (this.lookPointer !== e.pointerId) return;
      const dx = e.clientX - this.lookLast.x;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.input.addTouchLook(dx * this.input.sensitivity * 2.4);
      e.preventDefault();
    };
    const lookEnd = (e) => {
      if (this.lookPointer !== e.pointerId) return;
      this.lookPointer = null;
    };

    canvas.addEventListener('pointerdown', lookStart);
    canvas.addEventListener('pointermove', lookMove);
    canvas.addEventListener('pointerup', lookEnd);
    canvas.addEventListener('pointercancel', lookEnd);

    // ---------- botao de tiro ----------
    const fireDown = (e) => {
      this.input.setTouchFire(true);
      this.hideHint();
      e.preventDefault();
      e.stopPropagation();
    };
    const fireUp = (e) => {
      this.input.setTouchFire(false);
      e.preventDefault();
      e.stopPropagation();
    };
    this.fireBtn.addEventListener('pointerdown', fireDown);
    this.fireBtn.addEventListener('pointerup', fireUp);
    this.fireBtn.addEventListener('pointercancel', fireUp);
    this.fireBtn.addEventListener('pointerleave', fireUp);

    // ---------- botoes de acao ----------
    this.reloadBtn.addEventListener('pointerdown', (e) => {
      this.input.touchPress('KeyR');
      e.preventDefault(); e.stopPropagation();
    });
    this.crouchBtn.addEventListener('pointerdown', (e) => {
      const on = !this.input.touch.crouch;
      this.input.setTouchCrouch(on);
      this.crouchBtn.classList.toggle('active', on);
      e.preventDefault(); e.stopPropagation();
    });
    this.swapBtn.addEventListener('pointerdown', (e) => {
      this.input.touchPress('KeyQ');
      e.preventDefault(); e.stopPropagation();
    });
    this.pauseBtn.addEventListener('pointerdown', (e) => {
      this.onPause?.();
      e.preventDefault(); e.stopPropagation();
    });
  }

  hideHint() {
    if (this.hint) this.hint.classList.add('hidden');
  }
}
