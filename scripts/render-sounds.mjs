import { OfflineAudioContext } from 'node-web-audio-api';
import { writeFileSync, mkdirSync } from 'node:fs';

// INLINE COPY of the chiptune `coin` definition from src/hooks/notificationUtils.ts.
// All other notification sounds are real recordings shipped as static .wav files.
// When you change the coin synth, update BOTH this file and the TS source,
// then re-run `npm run render-sounds`.
const SOUNDS = {
  coin: [
    { frequency: 988, duration: 0.08, type: "square", gain: 0.2 },
    { frequency: 1319, duration: 0.3, type: "square", gain: 0.2 },
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
