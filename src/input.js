// Keyboard / mouse state with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.buttons = new Set();
    this.clicked = new Set(); // mouse buttons pressed since last frame
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.sensitivity = 1;
    this.onLockChange = null;
    this.onKey = null;
    this.lastForwardTap = 0;
    this.doubleTapSprint = false;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (e.code === 'KeyW') {
          const now = performance.now();
          if (now - this.lastForwardTap < 280) this.doubleTapSprint = true;
          this.lastForwardTap = now;
        }
      }
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e);
      if (this.locked || ['F3', 'F1', 'Tab', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.doubleTapSprint = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.buttons.clear();
        this.keys.clear();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch {
      // ignored: the browser may refuse right after the user pressed Esc
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  movement() {
    const k = this.keys;
    return {
      forward: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      strafe: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      jump: k.has('Space'),
      sneak: k.has('ShiftLeft') || k.has('ShiftRight'),
      sprint: k.has('ControlLeft') || k.has('ControlRight') || this.doubleTapSprint,
    };
  }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    return r;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
  }
}
