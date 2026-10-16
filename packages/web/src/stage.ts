// Draws composed 640x400 frames to a canvas and runs the screen transitions,
// the dimmed palette behind text, shakes, flashes and the ripple effect.
import { HEIGHT, WIDTH, dimPalette, type Effect, type Frame } from '@shizuku/engine';

const BLACK: Frame = { pixels: new Uint8Array(WIDTH * HEIGHT), palette: new Uint8Array(48) };

/** Same query as the portrait layout in style.css. */
export const PORTRAIT = '(orientation: portrait) and (max-width: 760px)';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Per-pixel reveal order in [0, 1) for each effect: pixel shows the new frame once progress passes it. */
function orderMap(effect: Effect): Float32Array | undefined {
  const map = new Float32Array(WIDTH * HEIGHT);
  const tile = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)] / 16;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let t: number;
      switch (effect) {
        case 'mask': t = tile(x, y); break;
        case 'wipe-down': t = y / HEIGHT; break;
        case 'wipe-right': case 'slide-right': t = x / WIDTH; break;
        case 'mask-wipe-right': t = (x / WIDTH) * 0.8 + tile(x, y) * 0.2; break;
        case 'diamonds': t = (Math.abs((x % 32) - 16) + Math.abs((y % 32) - 16)) / 32; break;
        case 'diamond-wipe': t = (x / WIDTH) * 0.7 + ((Math.abs((x % 32) - 16) + Math.abs((y % 32) - 16)) / 32) * 0.3; break;
        case 'slant-tiles': t = (((x >> 4) + (y >> 4)) % 8) / 8 * 0.5 + (x / WIDTH) * 0.5; break;
        case 'vertical-close': t = Math.min(y, HEIGHT - 1 - y) / (HEIGHT / 2); break;
        case 'spiral': {
          const a = (Math.atan2(y - HEIGHT / 2, x - WIDTH / 2) / Math.PI + 1) / 2;
          const r = Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) / Math.hypot(WIDTH / 2, HEIGHT / 2);
          t = (a + r * 3) % 1;
          break;
        }
        default: return undefined;
      }
      map[y * WIDTH + x] = Math.min(t, 0.999);
    }
  }
  return map;
}

const maps = new Map<Effect, Float32Array | undefined>();
const mapFor = (e: Effect) => {
  if (!maps.has(e)) maps.set(e, orderMap(e));
  return maps.get(e);
};

const DURATION: Partial<Record<Effect, number>> = { palette: 700, mask: 450, cut: 0 };

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private frame: Frame = BLACK;
  private dim = false;
  private rippleOn = false;
  private rippleStart = 0;
  /** Skip mode: transitions finish at once. */
  fast = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
    this.draw();
  }

  /** Dims the palette behind text, as the PC-98 does. */
  setDim(on: boolean) {
    // Upright phones show the text below the picture: nothing to dim for.
    if (on && matchMedia(PORTRAIT).matches) on = false;
    if (this.dim === on) return;
    this.dim = on;
    this.draw();
  }

  /** A colour mixed over the whole palette: black or white fades, grey (scripts' palette ops). */
  private tint = { rgb: 0, amount: 0 };

  private palette(frame: Frame) {
    const base = this.dim ? dimPalette(frame.palette) : frame.palette;
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

  private draw(frame = this.frame, palette = this.palette(frame)) {
    const d = this.image.data;
    const px = frame.pixels;
    for (let i = 0; i < px.length; i++) {
      const c = px[i] * 3;
      d[i * 4] = palette[c];
      d[i * 4 + 1] = palette[c + 1];
      d[i * 4 + 2] = palette[c + 2];
      d[i * 4 + 3] = 255;
    }
    if (this.rippleOn) this.applyRipple(d);
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

  /** Transitions to `next` (a black frame for clears). */
  async transition(next: Frame, effect: Effect): Promise<void> {
    let from = this.frame;
    if (this.tint.amount > 0) {
      // Showing a picture sets its palette: a black (or white) screen is what we transition from.
      from = this.tint.amount >= 1 ? solid(this.tint.rgb) : { pixels: from.pixels, palette: this.palette(from) };
      this.tint = { rgb: 0, amount: 0 };
    }
    this.frame = next;
    const duration = this.fast ? 0 : (DURATION[effect] ?? 800);
    if (duration === 0) return this.draw();
    if (effect === 'palette') {
      // Fade through black: out with the old palette, in with the new.
      const fromBlack = from.pixels === BLACK.pixels;
      const toBlack = next.pixels === BLACK.pixels;
      if (!fromBlack) await this.animate(duration / (toBlack ? 1 : 2), (p) => this.draw(from, scale(this.palette(from), 1 - p)));
      if (!toBlack) await this.animate(duration / (fromBlack ? 1 : 2), (p) => this.draw(next, scale(this.palette(next), p)));
      return this.draw();
    }
    const map = mapFor(effect)!;
    // Old and new frames have different palettes: draw both in RGB.
    const a = rgba(from, this.palette(from));
    const b = rgba(next, this.palette(next));
    await this.animate(duration, (p) => {
      const d = this.image.data;
      for (let i = 0; i < map.length; i++) {
        const src = map[i] < p ? b : a;
        d[i * 4] = src[i * 4];
        d[i * 4 + 1] = src[i * 4 + 1];
        d[i * 4 + 2] = src[i * 4 + 2];
        d[i * 4 + 3] = 255;
      }
      this.ctx.putImageData(this.image, 0, 0);
    });
    this.draw();
  }

  clear(effect: Effect) {
    return this.transition(BLACK, effect);
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

function solid(rgb: number): Frame {
  return rgb === 0 ? BLACK : { pixels: BLACK.pixels, palette: new Uint8Array(48).fill(rgb) };
}

function rgba(frame: Frame, palette: Uint8Array) {
  const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < frame.pixels.length; i++) {
    const c = frame.pixels[i] * 3;
    out[i * 4] = palette[c];
    out[i * 4 + 1] = palette[c + 1];
    out[i * 4 + 2] = palette[c + 2];
  }
  return out;
}

const scale = (p: Uint8Array, k: number) => p.map((v) => v * k);
const mix = (a: Uint8Array, b: Uint8Array, k: number) => a.map((v, i) => v + (b[i] - v) * k);
