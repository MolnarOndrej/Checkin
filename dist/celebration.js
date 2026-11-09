const canvas = document.getElementById('effects');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const palette = ['#e8ffad', '#f6c285', '#bba8fc', '#a4eddb', '#ffa9c2', '#fff5c7'];
const pick = (choices) => choices[Math.floor(Math.random() * choices.length)];
const between = (min, max) => min + Math.random() * (max - min);
const fullEffects = ['confetti', 'starburst', 'ribbons', 'fireworks', 'aurora', 'comet'];
const partialEffects = ['glimmer', 'waypoints', 'sprout'];
let lastEffect;
let animation;
let audio;

function sizeCanvas() {
  const ratio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function run(duration, draw) {
  if (!ctx || reducedMotion.matches) return;
  cancelAnimationFrame(animation);
  sizeCanvas();
  const start = performance.now();
  function frame(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const elapsed = now - start;
    if (elapsed >= duration || reducedMotion.matches) return;
    draw(elapsed / 1000);
    animation = requestAnimationFrame(frame);
  }
  animation = requestAnimationFrame(frame);
}

function star(size) {
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * .24, -size * .24);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * .24, size * .24);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * .24, size * .24);
  ctx.lineTo(-size, 0);
  ctx.lineTo(-size * .24, -size * .24);
  ctx.closePath();
  ctx.fill();
}

function particle({ x, y, vx, vy, gravity, size, spin, color, shape, life, delay = 0 }, elapsed) {
  const time = elapsed - delay;
  if (time < 0 || time >= life) return;
  const age = time / life;
  ctx.save();
  ctx.globalAlpha = Math.min(time * 14, (1 - age) * 2.6, 1);
  ctx.translate(x + vx * time, y + vy * time + gravity * time * time / 2);
  ctx.rotate(spin * time);
  ctx.fillStyle = color;
  if (shape === 'star') {
    star(size * (1 - age * .35));
  } else if (shape === 'ribbon') {
    ctx.scale(Math.cos(time * 12), 1);
    ctx.fillRect(-size / 2, -size * 1.4, size, size * 2.8);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * (1 - age * .6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function burst(x, y, count, options) {
  const { speed, gravity = 85, shape = 'star', delay = 0, color, scale = 1, lift = 0 } = options;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count + between(-.13, .13);
    const velocity = speed * between(.35, 1);
    return {
      x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity - lift,
      gravity, shape, delay, color: color ?? pick(palette), size: between(2, 6.5) * scale,
      spin: between(-8, 8), life: between(.55, 1.4),
    };
  });
}

function ring({ x, y, color, delay = 0, size = 90 }, elapsed) {
  const age = (elapsed - delay) / .66;
  if (age < 0 || age >= 1) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = (1 - age) * .65;
  ctx.beginPath();
  ctx.arc(x, y, 7 + size * (1 - (1 - age) ** 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function makeEffect(effect, x, y) {
  const motes = [];
  const rings = [];
  const color = pick(palette);
  switch (effect) {
    case 'confetti':
      motes.push(...burst(x, y, 74, { speed: 480, gravity: 480, shape: 'ribbon', lift: 145 }));
      break;
    case 'starburst':
      rings.push({ x, y, color, size: 165 }, { x, y, color, delay: .13, size: 115 });
      motes.push(...burst(x, y, 45, { speed: 360, scale: 1.25 }));
      break;
    case 'ribbons':
      for (const side of [.04, .96]) {
        motes.push(...burst(innerWidth * side, innerHeight * .77, 56, { speed: 550, gravity: 390, shape: 'ribbon', lift: 400 }));
      }
      break;
    case 'fireworks':
      for (const [index, side] of [.28, .68, .48].entries()) {
        const origin = { x: innerWidth * side, y: innerHeight * between(.22, .48), color: pick(palette), delay: index * .26 };
        rings.push(origin);
        motes.push(...burst(origin.x, origin.y, 54, { ...origin, speed: 275, shape: 'dot' }));
      }
      break;
    case 'aurora':
      for (let index = 0; index < 9; index++) {
        const origin = { x: innerWidth * (index + 1) / 10, y: innerHeight * between(.2, .47), delay: index * .08 };
        motes.push(...burst(origin.x, origin.y, 16, { ...origin, speed: 145, lift: 65, color: palette[index % palette.length] }));
      }
      break;
    case 'comet':
      for (let index = 0; index < 11; index++) {
        const origin = { x: innerWidth * (.13 + index * .075), y: innerHeight * (.18 + index * .049), delay: index * .07 };
        motes.push(...burst(origin.x, origin.y, 12, { ...origin, speed: 150, gravity: 155, color: pick(palette), scale: 1.15 }));
      }
      break;
    case 'waypoints':
      for (let index = 0; index < 3; index++) {
        const origin = { x: x + (index - 1) * 40, y: y - index * 20, color, delay: index * .12 };
        rings.push({ ...origin, size: 34 });
        motes.push(...burst(origin.x, origin.y, 9, { ...origin, speed: 72, scale: .62 }));
      }
      break;
    case 'sprout':
      motes.push(...burst(x, y, 28, { speed: 100, gravity: 75, lift: 115, scale: .77, color: '#dcf29c' }));
      break;
    case 'glimmer':
      rings.push({ x, y, color, size: 60 });
      motes.push(...burst(x, y, 19, { speed: 135, scale: .75 }));
      break;
  }
  return { motes, rings };
}

const fullTunes = [
  [60, 64, 67, 72, 76],
  [62, 69, 74, 78, 81],
  [65, 69, 72, 77, 84],
];
const shortTunes = [[67, 72], [64, 69, 72], [62, 66, 69]];

function playTune(full) {
  try {
    audio ??= new AudioContext();
    // A save click provides the user activation required by browser audio policies.
    audio.resume().then(() => {
      const tune = pick(full ? fullTunes : shortTunes);
      const start = audio.currentTime + .02;
      for (const [index, note] of tune.entries()) {
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        const time = start + index * (full ? .102 : .125);
        const duration = index === tune.length - 1 ? .52 : .25;
        tone.type = full ? 'triangle' : 'sine';
        tone.frequency.value = 440 * 2 ** ((note - 69) / 12);
        volume.gain.setValueAtTime(.001, time);
        volume.gain.exponentialRampToValueAtTime(full ? .095 : .055, time + .022);
        volume.gain.exponentialRampToValueAtTime(.001, time + duration);
        tone.connect(volume).connect(audio.destination);
        tone.start(time);
        tone.stop(time + duration);
      }
    }).catch(() => {});
  } catch {
    // Visual feedback remains available when audio is unavailable.
  }
}

export function celebrate(origin, score, muted) {
  const full = score === 100;
  const effect = pick((full ? fullEffects : partialEffects).filter((name) => name !== lastEffect));
  lastEffect = effect;
  if (!reducedMotion.matches) {
    const { motes, rings } = makeEffect(effect, origin.left + origin.width / 2, origin.top + origin.height / 2);
    run(2250, (elapsed) => {
      rings.forEach((pulse) => ring(pulse, elapsed));
      motes.forEach((mote) => particle(mote, elapsed));
    });
  }
  if (!muted) playTune(full);
}

export function playOpening() {
  if (reducedMotion.matches) return;
  const bounds = document.querySelector('.hero').getBoundingClientRect();
  const variant = pick(['starlight', 'meteor', 'fireflies']);
  const motes = [];
  if (variant === 'meteor') {
    for (let index = 0; index < 8; index++) {
      motes.push(...burst(bounds.left + bounds.width * (.52 + index * .052), bounds.top + 35 + index * 12, 5, {
        speed: 45, gravity: 0, scale: .53, delay: .2 + index * .085,
      }));
    }
  } else {
    for (let index = 0; index < 27; index++) {
      motes.push({
        x: bounds.left + bounds.width * between(.43, .98), y: bounds.top + bounds.height * between(.15, .86),
        vx: between(-14, 14), vy: variant === 'fireflies' ? between(-34, -8) : 2, gravity: 0,
        size: between(1.1, 3.2), spin: 0, color: '#f1f7c2', shape: variant === 'fireflies' ? 'dot' : 'star',
        life: between(.45, 1.2), delay: between(.15, .8),
      });
    }
  }
  run(2050, (elapsed) => motes.forEach((mote) => particle(mote, elapsed)));
}
