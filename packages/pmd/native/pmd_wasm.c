// WebAssembly glue around 98fmplayer's PMD driver and OPNA emulator.
//
// One song per module instance. The chip runs at its native rate
// (7987200 / 144 ≈ 55467 Hz); render() resamples to the requested rate with a
// windowed-sinc polyphase filter and returns interleaved stereo float32.
//
// Everything here is MIT (see ../LICENSE); the vendored 98fmplayer sources are
// BSD-2-Clause (see 98fmplayer/LICENSE).
#include <math.h>
#include <stdint.h>
#include <string.h>
#include <emscripten/emscripten.h>

#include "fmdriver/fmdriver.h"
#include "fmdriver/fmdriver_pmd.h"
#include "fmdriver/ppz8.h"
#include "libopna/opna.h"
#include "libopna/opnatimer.h"

// Defined in fmdriver_pmd.c but not declared in its header.
const char *pmd_get_memo(const struct driver_pmd *pmd, int index);

#define CHIP_RATE 55467
#define PPZ8MIX 0xa000
#define MAX_OUT_FRAMES 16384

// --- chip + driver -----------------------------------------------------------

static struct opna opna;
static struct opna_timer timer;
static struct ppz8 ppz8;
static struct fmdriver_work work;
static struct driver_pmd pmd;
static uint8_t adpcm_ram[OPNA_ADPCM_RAM_SIZE];
static uint8_t song[0x10000];     // the driver plays from this buffer
static uint8_t input[0x10000];    // JS writes the .M file here
static uint8_t rom[OPNA_ROM_SIZE]; // optional YM2608 rhythm ROM from the user

// Where the OPNA rhythm section's samples come from.
enum { RHYTHM_OFF = 0, RHYTHM_ROM = 1, RHYTHM_SYNTH = 2 };
static int rhythm_mode = RHYTHM_SYNTH;
void drums_synthesize(struct opna_drum *drum);
static int loaded;
static unsigned mute_mask; // libopna LIBOPNA_CHAN_* bits

// Diagnostics: which OPNA rhythm voices (bits 0-5: BD SD TOP HH TOM RIM)
// have been keyed on since load, and how many key-on writes there were.
static unsigned rhythm_keyon_mask;
static unsigned rhythm_keyon_count;

// Song position, in chip frames.
static uint64_t chip_frames;

static void w_writereg(struct fmdriver_work *w, unsigned addr, unsigned data) {
  (void)w;
  if (addr == 0x10 && !(data & 0x80) && (data & 0x3f)) {
    rhythm_keyon_mask |= data & 0x3f;
    rhythm_keyon_count++;
  }
  opna_timer_writereg(&timer, addr, data);
}

static unsigned w_readreg(struct fmdriver_work *w, unsigned addr) {
  (void)w;
  return opna_readreg(&opna, addr);
}

static uint8_t w_status(struct fmdriver_work *w, bool a1) {
  (void)w;
  uint8_t status = opna_timer_status(&timer);
  if (!a1) status &= 0x83;
  return status;
}

static void int_cb(void *p) {
  struct fmdriver_work *w = p;
  w->driver_opna_interrupt(w);
}

static void mix_cb(void *p, int16_t *buf, unsigned frames) {
  ppz8_mix((struct ppz8 *)p, buf, frames);
}

static void chip_reset(void) {
  opna_reset(&opna);
  opna_set_mask(&opna, mute_mask);
  if (rhythm_mode == RHYTHM_ROM) opna_drum_set_rom(&opna.drum, rom);
  else if (rhythm_mode == RHYTHM_SYNTH) drums_synthesize(&opna.drum);
  opna_adpcm_set_ram_256k(&opna.adpcm, adpcm_ram);
  opna_timer_reset(&timer, &opna);
  ppz8_init(&ppz8, CHIP_RATE, PPZ8MIX);
  memset(&work, 0, sizeof(work));
  work.opna_writereg = w_writereg;
  work.opna_readreg = w_readreg;
  work.opna_status = w_status;
  work.opna = &timer;
  work.ppz8 = &ppz8;
  work.ppz8_functbl = &ppz8_functbl;
  opna_timer_set_int_callback(&timer, int_cb, &work);
  opna_timer_set_mix_callback(&timer, mix_cb, &ppz8);
}

// --- loop length: run the driver without a chip ------------------------------
// Each timer B interrupt lasts (256 - TB) * 16 chip frames in libopna.

static struct {
  int pending; // status reads left that report timer B
} dry;

static void dry_writereg(struct fmdriver_work *w, unsigned a, unsigned d) { (void)w; (void)a; (void)d; }
static unsigned dry_readreg(struct fmdriver_work *w, unsigned a) { (void)w; (void)a; return 0xff; }
static uint8_t dry_status(struct fmdriver_work *w, bool a1) {
  (void)w; (void)a1;
  if (dry.pending > 0) { dry.pending--; return 2; }
  return 0;
}

static struct driver_pmd dry_pmd;
static uint8_t dry_song[0x10000];
static double first_pass_frames, loop_frames; // -1 when unknown

static void measure(unsigned len) {
  struct fmdriver_work dw;
  memset(&dw, 0, sizeof(dw));
  dw.opna_writereg = dry_writereg;
  dw.opna_readreg = dry_readreg;
  dw.opna_status = dry_status;
  memcpy(dry_song, input, len);
  memset(&dry_pmd, 0, sizeof(dry_pmd));
  first_pass_frames = loop_frames = -1;
  if (!pmd_load(&dry_pmd, dry_song, len)) return;
  pmd_init(&dw, &dry_pmd);
  // A song without a loop point ends with a few ticks in which the driver
  // still counts loops, so a loop only counts if playback goes on for 2 s
  // after it.
  double frames = 0, first = -1, second = -1;
  for (uint32_t tick = 0; tick < 0x100000; tick++) {
    frames += (256 - dry_pmd.timerb) * 16.0;
    dry.pending = 2;
    dw.driver_opna_interrupt(&dw);
    if (!dw.playing || dw.loop_cnt == 0xff) { // song ended, no loop
      first_pass_frames = first >= 0 ? first : frames;
      return;
    }
    if (dw.loop_cnt >= 1 && first < 0) first = frames;
    if (dw.loop_cnt >= 2 && second < 0) second = frames;
    if (second >= 0 && frames - second > 2 * CHIP_RATE) {
      first_pass_frames = first;
      loop_frames = second - first;
      return;
    }
  }
}

// --- resampler ---------------------------------------------------------------

#define HALF 16
#define TAPS (HALF * 2)
#define PHASES 256
#define HIST 8192

static float kernel[PHASES + 1][TAPS];
static float hist[2][HIST];
static int hist_len;
static double hist_pos;
static double step;
static int out_rate;
static float outbuf[MAX_OUT_FRAMES * 2];
static int16_t chipbuf[1024 * 2];

static double bessel_i0(double x) {
  double sum = 1, term = 1;
  for (int k = 1; k < 32; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}

static void build_kernel(void) {
  double ratio = (double)out_rate / CHIP_RATE;
  double fc = (ratio < 1 ? ratio : 1) * 0.5 * 0.92; // cycles per input sample
  const double beta = 8.0;
  double i0b = bessel_i0(beta);
  for (int p = 0; p <= PHASES; p++) {
    double frac = (double)p / PHASES;
    double sum = 0;
    for (int j = 0; j < TAPS; j++) {
      double t = (j - HALF + 1) - frac;
      double x = 2 * fc * t;
      double s = t == 0 ? 2 * fc : sin(M_PI * x) / (M_PI * t);
      double r = t / HALF;
      double win = (r <= -1 || r >= 1) ? 0 : bessel_i0(beta * sqrt(1 - r * r)) / i0b;
      kernel[p][j] = (float)(s * win);
      sum += s * win;
    }
    for (int j = 0; j < TAPS; j++) kernel[p][j] = (float)(kernel[p][j] / sum);
  }
}

static void resampler_reset(void) {
  memset(hist, 0, sizeof(hist));
  hist_len = HALF; // leading silence so the first taps have history
  hist_pos = HALF;
}

static void generate(void) {
  if (hist_len + 1024 > HIST) {
    int drop = (int)hist_pos - HALF;
    memmove(hist[0], hist[0] + drop, (hist_len - drop) * sizeof(float));
    memmove(hist[1], hist[1] + drop, (hist_len - drop) * sizeof(float));
    hist_len -= drop;
    hist_pos -= drop;
  }
  memset(chipbuf, 0, sizeof(chipbuf));
  if (loaded && work.playing) opna_timer_mix(&timer, chipbuf, 1024);
  for (int i = 0; i < 1024; i++) {
    hist[0][hist_len + i] = chipbuf[i * 2] * (1.0f / 32768);
    hist[1][hist_len + i] = chipbuf[i * 2 + 1] * (1.0f / 32768);
  }
  hist_len += 1024;
  chip_frames += 1024;
}

// --- exports -------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE uint8_t *pmdw_input(void) { return input; }
EMSCRIPTEN_KEEPALIVE uint8_t *pmdw_rom(void) { return rom; }
EMSCRIPTEN_KEEPALIVE float *pmdw_output(void) { return outbuf; }
EMSCRIPTEN_KEEPALIVE int pmdw_max_frames(void) { return MAX_OUT_FRAMES; }

EMSCRIPTEN_KEEPALIVE void pmdw_init(int rate) {
  out_rate = rate;
  step = (double)CHIP_RATE / rate;
  build_kernel();
  chip_reset();
  resampler_reset();
}

// 0 silent, 1 the ROM written to pmdw_rom() (0x2000 bytes), 2 synthesized
// (default). Applies from the next load.
EMSCRIPTEN_KEEPALIVE void pmdw_rhythm_mode(int mode) { rhythm_mode = mode; }

// Mutes chip channels: bits 0-5 FM 1-6, 6-8 SSG 1-3, 9-14 rhythm, 15 ADPCM.
EMSCRIPTEN_KEEPALIVE void pmdw_mute(unsigned mask) {
  mute_mask = mask;
  opna_set_mask(&opna, mask);
}

EMSCRIPTEN_KEEPALIVE int pmdw_load(unsigned len) {
  loaded = 0;
  if (len < 2 || len > sizeof(input)) return 0;
  measure(len);
  chip_reset();
  resampler_reset();
  memset(&pmd, 0, sizeof(pmd));
  memcpy(song, input, len);
  if (!pmd_load(&pmd, song, len)) return 0;
  pmd_init(&work, &pmd);
  rhythm_keyon_mask = rhythm_keyon_count = 0;
  chip_frames = 0;
  loaded = 1;
  return 1;
}

EMSCRIPTEN_KEEPALIVE void pmdw_stop(void) {
  loaded = 0;
  chip_frames = 0;
  chip_reset();
  resampler_reset();
}

// Renders `frames` (<= MAX_OUT_FRAMES) output frames into pmdw_output().
EMSCRIPTEN_KEEPALIVE void pmdw_render(int frames) {
  for (int n = 0; n < frames; n++) {
    int i0 = (int)hist_pos;
    while (i0 + HALF >= hist_len) {
      generate();
      i0 = (int)hist_pos;
    }
    double fp = (hist_pos - i0) * PHASES;
    int p = (int)fp;
    float a = (float)(fp - p);
    const float *k0 = kernel[p], *k1 = kernel[p + 1];
    const float *l = &hist[0][i0 - HALF + 1], *r = &hist[1][i0 - HALF + 1];
    float sl = 0, sr = 0;
    for (int j = 0; j < TAPS; j++) {
      float k = k0[j] + (k1[j] - k0[j]) * a;
      sl += l[j] * k;
      sr += r[j] * k;
    }
    outbuf[n * 2] = sl;
    outbuf[n * 2 + 1] = sr;
    hist_pos += step;
  }
}

EMSCRIPTEN_KEEPALIVE int pmdw_playing(void) { return loaded && work.playing; }
// 0 during the first pass, n after n passes, 255 when a non-looping song ended.
EMSCRIPTEN_KEEPALIVE int pmdw_loop_count(void) { return work.loop_cnt; }
EMSCRIPTEN_KEEPALIVE double pmdw_position(void) { return (chip_frames - (hist_len - hist_pos)) / CHIP_RATE; }
EMSCRIPTEN_KEEPALIVE double pmdw_first_pass(void) { return first_pass_frames < 0 ? -1 : first_pass_frames / CHIP_RATE; }
EMSCRIPTEN_KEEPALIVE double pmdw_loop_length(void) { return loop_frames < 0 ? -1 : loop_frames / CHIP_RATE; }
EMSCRIPTEN_KEEPALIVE unsigned pmdw_rhythm_mask(void) { return rhythm_keyon_mask; }
EMSCRIPTEN_KEEPALIVE unsigned pmdw_rhythm_count(void) { return rhythm_keyon_count; }
// Memo strings (title, composer, ...) as CP932; index as in pmd_get_memo.
EMSCRIPTEN_KEEPALIVE const char *pmdw_memo(int index) { return loaded ? pmd_get_memo(&pmd, index) : 0; }
