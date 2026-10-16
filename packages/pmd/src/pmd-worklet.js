// AudioWorklet side of PmdPlayer: plays interleaved stereo float32 chunks
// pushed from the main thread through a ring buffer, and reports how much is
// queued after each push. Messages: a Float32Array to queue, or 'clear'.
class PmdOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = sampleRate; // 1 s
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.read = 0;
    this.size = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'clear') {
        this.size = 0;
      } else {
        this.push(e.data);
      }
      this.port.postMessage(this.size);
    };
  }

  push(pcm) {
    const frames = pcm.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.size === this.capacity) {
        // Running ahead: drop the oldest audio.
        this.read = (this.read + 1) % this.capacity;
        this.size--;
      }
      const w = (this.read + this.size) % this.capacity;
      this.left[w] = pcm[i * 2];
      this.right[w] = pcm[i * 2 + 1];
      this.size++;
    }
  }

  process(_inputs, outputs) {
    const [l, r] = outputs[0];
    for (let i = 0; i < l.length; i++) {
      if (this.size > 0) {
        l[i] = this.left[this.read];
        r[i] = this.right[this.read];
        this.read = (this.read + 1) % this.capacity;
        this.size--;
      } else {
        l[i] = 0;
        r[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor('pmd-output', PmdOutput);
