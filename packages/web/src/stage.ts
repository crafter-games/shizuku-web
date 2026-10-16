// Draws composed 640x400 frames to a canvas and runs the PC-98's screen
// transitions (@shizuku/engine effects.ts), the dimmed palette behind text,
// shakes, flashes, the ripple effect and vsync-timed animations (the opening).
import {
  HEIGHT, WIDTH, VSYNC_MS, Screen, compose, dimPalette, gameRandom, paint, transition,
  type Effect, type Frame, type TransitionData,
} from '@shizuku/engine';

const BLACK: Frame = { pixels: new Uint8Array(WIDTH * HEIGHT), palette: new Uint8Array(48) };

/** Same query as the portrait layout in style.css. */
export const PORTRAIT = '(orientation: portrait) and (max-width: 760px)';

/** The PC-98 dims and undims the palette behind text in 5 steps of 2 vsyncs. */
const DIM_STEPS = 5;

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly out: Uint32Array;
  /** The graphics and the text-layer mask, as transitions draw them. */
  private readonly layers = { screen: new Uint32Array(WIDTH * HEIGHT), cover: new Uint8Array(WIDTH * HEIGHT) };
  private frame: Frame = BLACK;
  /** Dim step, 0 (normal) to DIM_STEPS (10/15). */
  private dim = 0;
  private dimTarget = 0;
  private rippleOn = false;
  private rippleStart = 0;
  /** Glyphs and tables the transitions need from the disks. */
  data: TransitionData | undefined;
  /** Skip mode: transitions finish at once. */
  fast = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
    this.out = new Uint32Array(this.image.data.buffer);
    this.draw();
  }

  /** Dims the palette behind text, as the PC-98 does; resolves when the fade is done. */
  async setDim(on: boolean): Promise<void> {
    // Upright phones show the text below the picture: nothing to dim for.
    if (on && matchMedia(PORTRAIT).matches) on = false;
    const target = on ? DIM_STEPS : 0;
    if (this.dimTarget === target) return;
    this.dimTarget = target;
    if (this.fast) {
      this.dim = target;
      return this.draw();
    }
    await this.ticks(DIM_STEPS, 2, () => {
      if (this.dimTarget !== target) return false;
      this.dim += Math.sign(target - this.dim);
      this.draw();
      return this.dim !== target;
    });
  }

  /** Lifts the dim at once (transitions that cut, or the PC-98's palette reset). */
  private undimNow() {
    this.dim = this.dimTarget = 0;
  }

  /** A colour mixed over the whole palette: black or white fades, grey (scripts' palette ops). */
  private tint = { rgb: 0, amount: 0 };

  private palette(frame: Frame, dim = this.dim) {
    const base = dim ? dimPalette(frame.palette, dim) : frame.palette;
    if (this.tint.amount === 0) return base;
    const { rgb, amount } = this.tint;
    return base.map((v) => v + (rgb - v) * amount);
  }

  /** Sets or fades the tint (0 = the picture's own colours, 1 = all `rgb`). */
  async setTint(rgb: number, amount: number, ms = 0) {
    const from = this.tint.rgb === rgb ? this.tint.amount : this.tint.amount > 0 ? this.tint.amount : 0;
    if (this.tint.rgb !== rgb && this.tint.amount > 0 && amount > 0) {
      // Switching tint colour mid-way (e.g. white to black): jump.
      this.tint = { rgb, amount: from };
    }
    this.tint.rgb = rgb;
    if (this.fast || ms <= 0) {
      this.tint.amount = amount;
      return this.draw();
    }
    await this.animate(ms, (p) => {
      this.tint.amount = from + (amount - from) * p;
      this.draw();
    });
  }

  /** Shows `frame` with the current dim and tint. */
  private draw(frame = this.frame, palette = this.palette(frame)) {
    paint(frame, palette, this.layers.screen);
    this.layers.cover.fill(0);
    this.present();
  }

  private present() {
    compose(this.layers, this.out);
    if (this.rippleOn) this.applyRipple(this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }

  private applyRipple(d: Uint8ClampedArray) {
    const t = (performance.now() - this.rippleStart) / 1000;
    const row = new Uint8ClampedArray(WIDTH * 4);
    for (let y = 0; y < HEIGHT; y++) {
      const shift = Math.round(Math.sin(y / 14 + t * 3) * 6);
      row.set(d.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4));
      for (let x = 0; x < WIDTH; x++) {
        const sx = Math.min(WIDTH - 1, Math.max(0, x + shift));
        d.set(row.subarray(sx * 4, sx * 4 + 4), (y * WIDTH + x) * 4);
      }
    }
  }

  ripple(on: boolean) {
    this.rippleOn = on;
    this.rippleStart = performance.now();
    const tick = () => {
      if (!this.rippleOn) return this.draw();
      this.draw();
      requestAnimationFrame(tick);
    };
    if (on) requestAnimationFrame(tick);
  }

  /** The picture on screen as a frame with the palette it is shown with. */
  private shown(): Frame {
    if (this.tint.amount >= 1) return { pixels: BLACK.pixels, palette: new Uint8Array(48).fill(this.tint.rgb) };
    return { pixels: this.frame.pixels, palette: this.palette(this.frame) };
  }

  /** Shows `next` with a PC-98 transition, from what is on screen. Without an effect nothing changes. */
  async transition(next: Frame, effect: Effect | undefined): Promise<void> {
    if (!effect) return;
    if (this.dim && effect !== 'cut') await this.setDim(false);
    this.undimNow();
    const from = this.shown();
    // Showing a picture sets its palette: tints from palette ops end here.
    this.tint = { rgb: 0, amount: 0 };
    this.frame = next;
    await this.run(effect, 'show', from, next);
  }

  /**
   * Clears to black with a PC-98 transition. Without an effect (99) only the
   * dim lifts. 'fade' fades from the dimmed palette, 'cut' lifts the dim at once.
   */
  async clear(effect: Effect | undefined): Promise<void> {
    if (effect === 'fade') {
      // Fades from the dimmed palette whether text was on screen or not.
      this.undimNow();
      const from = this.shown();
      this.tint = { rgb: 0, amount: 0 };
      this.frame = BLACK;
      return this.run(effect, 'clear', from, BLACK);
    }
    if (effect !== 'cut' && this.dim) await this.setDim(false);
    this.undimNow();
    if (!effect || effect === 'dissolve') return this.draw();
    const from = this.shown();
    this.tint = { rgb: 0, amount: 0 };
    this.frame = BLACK;
    await this.run(effect, 'clear', from, BLACK);
  }

  /** Cuts to a frame (e.g. what an animation leaves on screen). */
  setFrame(frame: Frame) {
    this.undimNow();
    this.tint = { rgb: 0, amount: 0 };
    this.frame = frame;
    this.draw();
  }

  private run(effect: Effect, phase: 'clear' | 'show', from: Frame, to: Frame) {
    const data = this.data ?? { kcode: [], squash: [] };
    paint(from, from.palette, this.layers.screen);
    this.layers.cover.fill(0);
    const program = transition(effect, phase, { ...data, from, to, random: gameRandom() }, this.layers);
    return this.steps(program);
  }

  /**
   * Runs a vsync-timed program: each step changes the layers and yields how
   * many vsyncs (56.42 Hz) to hold them. Drawn on animation frames; steps that
   * fall due together are run together.
   */
  private steps(program: Iterator<number>): Promise<void> {
    return new Promise((resolve) => {
      let due = performance.now();
      const tick = (now: number) => {
        let changed = false;
        while (this.fast || now >= due) {
          const r = program.next();
          if (r.done) {
            this.present();
            return resolve();
          }
          due += r.value * VSYNC_MS;
          changed = true;
        }
        if (changed) this.present();
        requestAnimationFrame(tick);
      };
      tick(performance.now());
    });
  }

  /** Calls `fn` `count` times, `every` vsyncs apart, the first after `every`; stops early when it returns false. */
  private ticks(count: number, every: number, fn: () => boolean): Promise<void> {
    const self = this;
    function* program() {
      for (let i = 0; i < count; i++) {
        yield every;
        if (!fn()) return;
      }
    }
    return new Promise((resolve) => {
      const it = program();
      let due = performance.now();
      const tick = (now: number) => {
        while (self.fast || now >= due) {
          const r = it.next();
          if (r.done) return resolve();
          due += r.value * VSYNC_MS;
        }
        requestAnimationFrame(tick);
      };
      tick(performance.now());
    });
  }

  /**
   * Plays a vsync-indexed animation: `render(t, screen)` draws vsync t and
   * returns false once there is nothing more to show. `stop()` ends it early.
   */
  play(render: (t: number, s: Screen) => boolean): { done: Promise<void>; stop: () => void } {
    const screen = new Screen();
    let stopped = false;
    let last = -1;
    const start = performance.now();
    const done = new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (stopped) return resolve();
        const t = Math.floor((now - start) / VSYNC_MS);
        if (t !== last) {
          last = t;
          if (!render(t, screen) || this.fast) return resolve();
          screen.toRgba(this.image.data);
          this.ctx.putImageData(this.image, 0, 0);
        }
        requestAnimationFrame(tick);
      };
      tick(start);
    });
    return { done, stop: () => (stopped = true) };
  }

  private animate(ms: number, step: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = this.fast ? 1 : Math.min(1, (now - start) / ms);
        step(p);
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  async flash() {
    const white: Frame = { pixels: this.frame.pixels, palette: new Uint8Array(48).fill(255) };
    const back = this.frame;
    await this.animate(this.fast ? 0 : 120, (p) => this.draw(back, mix(this.palette(back), white.palette, p)));
    await this.animate(this.fast ? 0 : 300, (p) => this.draw(back, mix(white.palette, this.palette(back), p)));
  }

  async shake(target: HTMLElement) {
    if (this.fast) return;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const t = now - start;
        if (t > 500) {
          target.style.transform = '';
          return resolve();
        }
        const amp = 8 * (1 - t / 500);
        target.style.transform = `translate(${(Math.random() - 0.5) * amp}px, ${(Math.random() - 0.5) * amp}px)`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** A small JPEG of the current frame, for save slots. */
  thumbnail(): string {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0, 160, 100);
    return c.toDataURL('image/jpeg', 0.7);
  }
}

const mix = (a: Uint8Array, b: Uint8Array, k: number) => a.map((v, i) => v + (b[i] - v) * k);
