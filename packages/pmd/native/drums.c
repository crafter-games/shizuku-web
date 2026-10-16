// Synthesized stand-ins for the YM2608 rhythm ROM (bass drum, snare, top
// cymbal, hi-hat, tom, rim shot). The real samples are Yamaha's and are not
// shipped; these are plain drum-machine recipes, written from scratch, at the
// chip's 55467 Hz output rate and no longer than the ROM's sounds.
#include <math.h>
#include <stdint.h>
#include "libopna/opnadrum.h"

#define SR 55467.0
#define PEAK 30000.0

static uint32_t seed;
static double noise(void) {
  seed = seed * 1664525u + 1013904223u;
  return (double)(int32_t)seed / 2147483648.0;
}

static int16_t clip(double v) {
  v *= PEAK;
  if (v > 32767) v = 32767;
  if (v < -32768) v = -32768;
  return (int16_t)v;
}

// Six detuned square waves: the classic analog-machine metal source.
static double metal(double t) {
  static const double f[6] = {205.3, 304.4, 369.6, 522.7, 540.0, 800.0};
  double s = 0;
  for (int i = 0; i < 6; i++) s += fmod(t * f[i] * 2, 1.0) < 0.5 ? 1 : -1;
  return s / 6;
}

static unsigned make_kick(int16_t *out, unsigned max) {
  double phase = 0;
  for (unsigned i = 0; i < max; i++) {
    double t = i / SR;
    double f = 55 + 140 * exp(-t / 0.012);
    phase += f / SR;
    double env = exp(-t / 0.030);
    double click = exp(-t / 0.0015) * 0.3 * noise();
    out[i] = clip((sin(2 * M_PI * phase) + click) * env * (i > max - 64 ? (max - i) / 64.0 : 1));
  }
  return max;
}

static unsigned make_snare(int16_t *out, unsigned max) {
  double phase = 0, hp = 0, prev = 0;
  for (unsigned i = 0; i < max; i++) {
    double t = i / SR;
    phase += 190 / SR;
    double n = noise();
    hp = 0.85 * (hp + n - prev); // one-pole high-pass
    prev = n;
    double v = 0.55 * sin(2 * M_PI * phase) * exp(-t / 0.010) + 0.6 * hp * exp(-t / 0.022);
    out[i] = clip(v * (i > max - 64 ? (max - i) / 64.0 : 1));
  }
  return max;
}

static unsigned make_metal(int16_t *out, unsigned max, double decay, double gain) {
  double hp = 0, prev = 0;
  for (unsigned i = 0; i < max; i++) {
    double t = i / SR;
    double x = 0.7 * metal(t) + 0.3 * noise();
    hp = 0.6 * (hp + x - prev);
    prev = x;
    out[i] = clip(gain * hp * exp(-t / decay) * (i > max - 64 ? (max - i) / 64.0 : 1));
  }
  return max;
}

static unsigned make_tom(int16_t *out, unsigned max) {
  double phase = 0;
  for (unsigned i = 0; i < max; i++) {
    double t = i / SR;
    phase += (110 + 60 * exp(-t / 0.04)) / SR;
    double v = sin(2 * M_PI * phase) * exp(-t / 0.045) + 0.1 * noise() * exp(-t / 0.005);
    out[i] = clip(v * (i > max - 64 ? (max - i) / 64.0 : 1));
  }
  return max;
}

static unsigned make_rim(int16_t *out, unsigned max) {
  for (unsigned i = 0; i < max; i++) {
    double t = i / SR;
    double v = (0.6 * sin(2 * M_PI * 1700 * t) + 0.4 * sin(2 * M_PI * 480 * t)) * exp(-t / 0.004);
    out[i] = clip(v);
  }
  return max;
}

void drums_synthesize(struct opna_drum *drum) {
  seed = 0x5eed;
  drum->drums[0].data = drum->rom_bd;
  drum->drums[1].data = drum->rom_sd;
  drum->drums[2].data = drum->rom_top;
  drum->drums[3].data = drum->rom_hh;
  drum->drums[4].data = drum->rom_tom;
  drum->drums[5].data = drum->rom_rim;
  // Keep to the ROM's lengths (BD 48 ms, SD 69 ms, TOP 644 ms, HH 42 ms, TOM 138 ms, RIM 28 ms).
  drum->drums[0].len = make_kick(drum->rom_bd, OPNA_ROM_BD_SIZE);
  drum->drums[1].len = make_snare(drum->rom_sd, OPNA_ROM_SD_SIZE);
  drum->drums[2].len = make_metal(drum->rom_top, OPNA_ROM_TOP_SIZE, 0.18, 0.8);
  drum->drums[3].len = make_metal(drum->rom_hh, OPNA_ROM_HH_SIZE, 0.010, 0.9);
  drum->drums[4].len = make_tom(drum->rom_tom, OPNA_ROM_TOM_SIZE);
  drum->drums[5].len = make_rim(drum->rom_rim, OPNA_ROM_RIM_SIZE);
  for (int d = 0; d < 6; d++) {
    drum->drums[d].playing = false;
    drum->drums[d].index = 0;
  }
}
