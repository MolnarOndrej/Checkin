const maxDuration = 5;
const fadeDuration = .75;
let audio;
let sounds;

export function unlockSubmitAudio() {
  try {
    // Resume during the submit gesture, before the journal lock is acquired.
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume().catch(() => {});
  } catch {
    // Saving a log also works when audio is unavailable.
  }
}

async function load(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response;
}

export async function playSubmitSound() {
  if (!audio) return;
  try {
    sounds ??= await (await load('/submitsounds.json')).json();
    if (!sounds.length) return;
    const path = sounds[Math.floor(Math.random() * sounds.length)];
    const response = await load(`/${path}`);
    const buffer = await audio.decodeAudioData(await response.arrayBuffer());
    if (audio.state !== 'running') return;

    const duration = Math.min(buffer.duration, maxDuration);
    const source = audio.createBufferSource();
    const volume = audio.createGain();
    source.buffer = buffer;
    source.connect(volume).connect(audio.destination);
    source.onended = () => {
      source.disconnect();
      volume.disconnect();
    };

    const started = audio.currentTime;
    if (buffer.duration > maxDuration) {
      volume.gain.setValueAtTime(1, started + duration - fadeDuration);
      volume.gain.linearRampToValueAtTime(0, started + duration);
    }
    source.start(started, 0, duration);
    return () => (audio.currentTime - started) / duration;
  } catch {
    // Use the standalone ripple if the clip cannot play.
    return undefined;
  }
}
