const maxDuration = 4;
const fadeDuration = .75;
const playbackGain = .25;
const onsetLevel = .01;
const resumeTimeoutMs = 1000;
let audio;
let sounds;

export async function unlockSubmitAudio() {
  let timeout;
  try {
    // Resume during the submit gesture, before the journal lock is acquired.
    audio ??= new AudioContext();
    if (audio.state === 'running') return;
    const resumed = audio.resume();
    const deadline = new Promise((resolve) => { timeout = setTimeout(resolve, resumeTimeoutMs); });
    // Autoplay restrictions can leave resume pending.
    await Promise.race([resumed, deadline]);
  } catch {
    // Saving a log also works when audio is unavailable.
  } finally {
    clearTimeout(timeout);
  }
}

async function load(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response;
}

function soundOffset(buffer) {
  // Look for an audible onset in the first second and keep 10 ms before it.
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const block = Math.round(buffer.sampleRate / 100);
  const limit = Math.min(buffer.length, buffer.sampleRate);
  const onsetEnergy = onsetLevel ** 2 * block * channels.length;
  for (let start = 0; start + block <= limit; start += block) {
    let energy = 0;
    for (const samples of channels) {
      for (let i = start; i < start + block; i++) energy += samples[i] ** 2;
    }
    if (energy >= onsetEnergy) return Math.max(0, start - block) / buffer.sampleRate;
  }
  return 0;
}

function outputTime(now) {
  const timestamp = audio.getOutputTimestamp?.();
  if (timestamp?.performanceTime) {
    return Math.min(audio.currentTime, timestamp.contextTime + (now - timestamp.performanceTime) / 1000);
  }
  return audio.currentTime - (audio.baseLatency ?? 0) - (audio.outputLatency ?? 0);
}

export async function playSubmitSound(audioReady) {
  if (!audio) return;
  try {
    sounds ??= await (await load('/submitsounds.json')).json();
    if (!sounds.length) return;
    const path = sounds[Math.floor(Math.random() * sounds.length)];
    const response = await load(`/${path}`);
    const buffer = await audio.decodeAudioData(await response.arrayBuffer());
    await audioReady;
    if (audio.state !== 'running') return;

    const offset = soundOffset(buffer);
    const duration = Math.min(buffer.duration - offset, maxDuration);
    const source = audio.createBufferSource();
    const volume = audio.createGain();
    source.buffer = buffer;
    source.connect(volume).connect(audio.destination);
    source.onended = () => {
      source.disconnect();
      volume.disconnect();
    };

    const started = audio.currentTime;
    const ends = started + duration;
    volume.gain.setValueAtTime(playbackGain, started);
    if (duration > fadeDuration) {
      volume.gain.setValueAtTime(playbackGain, ends - fadeDuration);
    }
    volume.gain.linearRampToValueAtTime(0, ends);
    source.start(started, offset, duration);
    return { duration, elapsedAt: (now) => outputTime(now) - started };
  } catch {
    // Use the standalone ripple if the clip cannot play.
    return undefined;
  }
}
