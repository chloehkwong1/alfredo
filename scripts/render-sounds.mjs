import { OfflineAudioContext } from 'node-web-audio-api';
import { writeFileSync, mkdirSync } from 'node:fs';

// INLINE COPY of SOUNDS from src/hooks/notificationUtils.ts.
// When you add/change a sound, update BOTH this file and the TS source,
// then re-run `npm run render-sounds`.
const SOUNDS = {
  coin:        [
    { frequency: 988, duration: 0.08, type: "square", gain: 0.2 },
    { frequency: 1319, duration: 0.3, type: "square", gain: 0.2 },
  ],
  zelda:       [
    { frequency: 523, duration: 0.12, type: "triangle" },
    { frequency: 659, duration: 0.12, type: "triangle" },
    { frequency: 784, duration: 0.12, type: "triangle" },
    { frequency: 1047, duration: 0.4, type: "triangle" },
  ],
  levelup:     [
    { frequency: 440, duration: 0.1, type: "square", gain: 0.18 },
    { frequency: 554, duration: 0.1, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 659, duration: 0.1, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 880, duration: 0.12, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 1108, duration: 0.12, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 1319, duration: 0.35, type: "square", gain: 0.22, delay: 0.0 },
  ],
  pinball:     [
    { frequency: 1200, duration: 0.03, type: "square", gain: 0.25 },
    { frequency: 1800, duration: 0.03, type: "square", gain: 0.2, delay: 0.0 },
    { frequency: 2400, duration: 0.05, type: "square", gain: 0.18, delay: 0.0 },
    { frequency: 1400, duration: 0.08, type: "square", gain: 0.15, delay: 0.06 },
    { frequency: 1800, duration: 0.12, type: "square", gain: 0.12, delay: 0.0 },
  ],
  r2d2:        [
    { frequency: 800, duration: 0.06, endFrequency: 2400 },
    { frequency: 2400, duration: 0.06, endFrequency: 1200, delay: 0.02 },
    { frequency: 1200, duration: 0.06, endFrequency: 1800, delay: 0.02 },
    { frequency: 1800, duration: 0.08, endFrequency: 600, delay: 0.02 },
  ],
  quack:       [
    { frequency: 600, duration: 0.06, type: "sawtooth", endFrequency: 200, gain: 0.2 },
    { frequency: 180, duration: 0.04, type: "sawtooth", gain: 0.08, delay: 0.0 },
    { frequency: 550, duration: 0.06, type: "sawtooth", endFrequency: 180, gain: 0.18, delay: 0.12 },
    { frequency: 160, duration: 0.04, type: "sawtooth", gain: 0.06, delay: 0.0 },
  ],
  submarine:   [
    { frequency: 1200, duration: 0.15, gain: 0.25 },
    { frequency: 1200, duration: 0.4, gain: 0.15, delay: 0.3 },
  ],
  train:       [
    { frequency: 330, duration: 0.3, type: "sawtooth", endFrequency: 370, gain: 0.15 },
    { frequency: 370, duration: 0.15, type: "sawtooth", endFrequency: 330, gain: 0.12, delay: 0.08 },
    { frequency: 340, duration: 0.5, type: "sawtooth", endFrequency: 380, gain: 0.18, delay: 0.1 },
  ],
  seatbelt:    [
    { frequency: 932, duration: 0.18, gain: 0.2 },
    { frequency: 1245, duration: 0.35, gain: 0.22, delay: 0.02 },
  ],
  shipbell:    [
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.2 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.18, delay: 0.08 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.15, delay: 0.25 },
    { frequency: 2200, duration: 0.12, type: "triangle", gain: 0.12, delay: 0.08 },
  ],
  cashregister:[
    { frequency: 200, duration: 0.02, type: "square", gain: 0.2 },
    { frequency: 1400, duration: 0.04, type: "triangle", gain: 0.22, delay: 0.0 },
    { frequency: 2800, duration: 0.08, type: "triangle", gain: 0.18, delay: 0.0 },
    { frequency: 2800, duration: 0.25, type: "triangle", gain: 0.12, delay: 0.02 },
  ],
  typewriter:  [
    { frequency: 1800, duration: 0.01, type: "square", gain: 0.15 },
    { frequency: 300, duration: 0.04, type: "square", endFrequency: 100, gain: 0.12, delay: 0.0 },
    { frequency: 2400, duration: 0.15, type: "triangle", gain: 0.2, delay: 0.06 },
  ],
  sparkle:     [
    { frequency: 1568, duration: 0.06, gain: 0.2 },
    { frequency: 1760, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 1976, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2093, duration: 0.06, gain: 0.2, delay: 0.02 },
    { frequency: 2349, duration: 0.2, gain: 0.2, delay: 0.02 },
  ],
};

const sampleRate = 44100;

function writeWav(path, buf) {
  const numSamples = buf.length;
  const pcm = new Int16Array(numSamples);
  const channel = buf.getChannelData(0);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channel[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const header = Buffer.alloc(44);
  const dataLen = pcm.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer)]));
}

async function renderOne(id, notes) {
  const totalSec = notes.reduce((acc, n) => acc + n.duration + (n.delay ?? 0.04), 0) + 0.1;
  const ctx = new OfflineAudioContext(1, Math.ceil(totalSec * sampleRate), sampleRate);
  let offset = 0;
  for (const note of notes) {
    if (note.frequency === 0 || note.duration === 0) continue;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = note.type ?? "sine";
    osc.frequency.setValueAtTime(note.frequency, offset);
    if (note.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(note.endFrequency, offset + note.duration);
    }
    const vol = note.gain ?? 0.3;
    gainNode.gain.setValueAtTime(vol, offset);
    gainNode.gain.exponentialRampToValueAtTime(0.001, offset + note.duration);
    osc.start(offset);
    osc.stop(offset + note.duration);
    offset += note.duration + (note.delay ?? 0.04);
  }
  const buf = await ctx.startRendering();
  writeWav(`src-tauri/sounds/${id}.wav`, buf);
  console.log(`wrote ${id}.wav`);
}

mkdirSync('src-tauri/sounds', { recursive: true });
for (const [id, notes] of Object.entries(SOUNDS)) {
  await renderOne(id, notes);
}
