const canvas = document.getElementById('effects');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const palettes = [
  ['#e8ffad', '#f6c285', '#bba8fc', '#a4eddb', '#ffa9c2', '#fff5c7'],
  ['#ffebaa', '#ffc672', '#ff9d8a', '#fff7df'],
  ['#a4eddb', '#a1d9ff', '#bdadff', '#d7f6ff'],
  ['#ffafd7', '#e5a4ff', '#a7b9ff', '#ffecb8'],
  ['#dfff91', '#82edbd', '#fcf2a4', '#c1e7ff'],
];
const pick = (choices) => choices[Math.floor(Math.random() * choices.length)];
const between = (min, max) => min + Math.random() * (max - min);
const fullEffects = ['confetti', 'starburst', 'ribbons', 'fireworks', 'aurora', 'comet', 'constellation', 'orbit', 'rain'];
const partialEffects = ['glimmer', 'waypoints', 'sprout', 'petals', 'mini-orbit', 'mini-constellation'];
const openingEffects = ['starlight', 'meteor', 'fireflies', 'constellation', 'orbit'];
const recentEffects = new Map();
let animation;
let audio;

function chooseEffect(group, choices) {
  const key = `checkin.effect.${group}`;
  let previous = recentEffects.get(group);
  try { previous ??= localStorage.getItem(key); } catch {}
  const next = pick(choices.filter((choice) => choice !== previous));
  recentEffects.set(group, next);
  try { localStorage.setItem(key, next); } catch {}
  return next;
}

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
  const { speed, gravity = 85, shape = 'star', delay = 0, color, colors = palettes[0], scale = 1, lift = 0 } = options;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count + between(-.13, .13);
    const velocity = speed * between(.35, 1);
    return {
      x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity - lift,
      gravity, shape, delay, color: color ?? pick(colors), size: between(2, 6.5) * scale,
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

function constellation(x, y, width, height, colors) {
  const count = Math.floor(between(5, 9));
  const points = Array.from({ length: count }, (_, index) => ({
    x: x + width * (index / (count - 1) - .5),
    y: y + height * between(-.5, .5),
    size: between(3, 7),
  }));
  const color = pick(colors);
  return (time) => {
    const opacity = Math.min(1, time * 4, (2.25 - time) * 2);
    if (opacity <= 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = opacity * .55;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < count; index++) {
      const progress = Math.min(1, Math.max(0, time * (count - 1) - index + 1));
      const previous = points[index - 1];
      const point = points[index];
      ctx.lineTo(previous.x + (point.x - previous.x) * progress, previous.y + (point.y - previous.y) * progress);
      if (progress < 1) break;
    }
    ctx.stroke();
    ctx.globalAlpha = opacity;
    for (const [index, point] of points.entries()) {
      if (time < index / (count - 1)) break;
      ctx.save();
      ctx.translate(point.x, point.y);
      star(point.size * (.85 + .15 * Math.cos(time * 7 + index)));
      ctx.restore();
    }
    ctx.restore();
  };
}

function orbit(x, y, radius, colors) {
  const direction = pick([-1, 1]);
  const tilt = between(-.36, .36);
  const phase = between(0, Math.PI * 2);
  const arms = pick([2, 3]);
  return (time) => {
    const opacity = Math.min(1, time * 5, (1.85 - time) * 2);
    if (opacity <= 0) return;
    const spread = radius * (.35 + .65 * Math.min(1, time * 1.4));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    for (let arm = 0; arm < arms; arm++) {
      ctx.fillStyle = colors[arm % colors.length];
      for (let trail = 9; trail >= 0; trail--) {
        const angle = phase + arm * Math.PI * 2 / arms + direction * (time * 5 - trail * .09);
        ctx.globalAlpha = opacity * (1 - trail / 10);
        ctx.save();
        ctx.translate(Math.cos(angle) * spread, Math.sin(angle) * spread * .47);
        star(Math.min(8, radius / 8) * (1 - trail / 12));
        ctx.restore();
      }
    }
    ctx.restore();
  };
}

function makeEffect(effect, x, y, colors) {
  const motes = [];
  const rings = [];
  const color = pick(colors);
  const energy = between(.83, 1.18);
  const spray = (left, top, count, options) => {
    motes.push(...burst(left, top, Math.round(count * energy), {
      ...options, speed: options.speed * energy, colors,
    }));
  };
  let drawPattern;
  switch (effect) {
    case 'confetti':
      spray(x, y, 74, { speed: 480, gravity: 480, shape: 'ribbon', lift: 145 });
      break;
    case 'starburst':
      rings.push({ x, y, color, size: 165 }, { x, y, color, delay: .13, size: 115 });
      spray(x, y, 45, { speed: 360, scale: 1.25 });
      break;
    case 'ribbons':
      for (const side of [.04, .96]) {
        spray(innerWidth * side, innerHeight * between(.65, .85), 56, { speed: 550, gravity: 390, shape: 'ribbon', lift: 400 });
      }
      break;
    case 'fireworks':
      for (const [index, side] of pick([[.25, .72, .49], [.67, .31, .52], [.46, .24, .76]]).entries()) {
        const origin = { x: innerWidth * side, y: innerHeight * between(.22, .48), color: pick(colors), delay: index * .26 };
        rings.push(origin);
        spray(origin.x, origin.y, 54, { ...origin, speed: 275, shape: pick(['dot', 'star']) });
      }
      break;
    case 'aurora':
      for (let index = 0; index < 9; index++) {
        const origin = { x: innerWidth * (index + 1) / 10, y: innerHeight * between(.2, .47), delay: index * .08 };
        spray(origin.x, origin.y, 16, { ...origin, speed: 145, lift: 65, color: colors[index % colors.length] });
      }
      break;
    case 'comet': {
      const direction = pick([-1, 1]);
      for (let index = 0; index < 11; index++) {
        const origin = { x: innerWidth * (.5 + direction * (index - 5) * .075), y: innerHeight * (.18 + index * .049), delay: index * .07 };
        spray(origin.x, origin.y, 12, { ...origin, speed: 150, gravity: 155, color: pick(colors), scale: 1.15 });
      }
      break;
    }
    case 'rain':
      for (let index = 0; index < 92; index++) {
        motes.push({
          x: innerWidth * between(.02, .98), y: innerHeight * between(.03, .32),
          vx: between(-50, 50), vy: between(25, 85), gravity: between(230, 440),
          size: between(3, 7), spin: between(-7, 7), color: pick(colors),
          shape: pick(['ribbon', 'star']), life: between(.8, 1.65), delay: between(0, .57),
        });
      }
      break;
    case 'constellation':
      drawPattern = constellation(innerWidth / 2, innerHeight * .34, innerWidth * .67, innerHeight * .28, colors);
      break;
    case 'orbit':
      drawPattern = orbit(innerWidth / 2, innerHeight * .38, Math.min(innerWidth, innerHeight) * .25, colors);
      rings.push({ x: innerWidth / 2, y: innerHeight * .38, color, delay: .37, size: 120 });
      break;
    case 'waypoints':
      for (let index = 0; index < 3; index++) {
        const origin = { x: x + (index - 1) * 40, y: y - index * 20, color, delay: index * .12 };
        rings.push({ ...origin, size: 34 });
        spray(origin.x, origin.y, 9, { ...origin, speed: 72, scale: .62 });
      }
      break;
    case 'sprout':
      spray(x, y, 28, { speed: 100, gravity: 75, lift: 115, scale: .77, color });
      break;
    case 'glimmer':
      rings.push({ x, y, color, size: 60 });
      spray(x, y, 19, { speed: 135, scale: .75 });
      break;
    case 'petals':
      for (const offset of [-55, 0, 55]) {
        spray(x + offset, y - 45, 9, { speed: 75, gravity: 175, shape: 'ribbon', delay: between(0, .25), scale: .78 });
      }
      break;
    case 'mini-orbit':
      drawPattern = orbit(x, y, 56 * energy, colors);
      break;
    case 'mini-constellation':
      drawPattern = constellation(x, y - 28, 145 * energy, 55, colors);
      break;
  }
  return (time) => {
    drawPattern?.(time);
    rings.forEach((pulse) => ring(pulse, time));
    motes.forEach((mote) => particle(mote, time));
  };
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
      const interval = full ? between(.085, .125) : between(.11, .145);
      const transpose = pick([-2, 0, 2, 5]);
      for (const [index, note] of tune.entries()) {
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        const time = start + index * interval;
        const duration = index === tune.length - 1 ? .52 : .25;
        tone.type = full ? 'triangle' : 'sine';
        tone.frequency.value = 440 * 2 ** ((note + transpose - 69) / 12);
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
  if (!reducedMotion.matches) {
    const effect = chooseEffect(full ? 'full' : 'partial', full ? fullEffects : partialEffects);
    const x = origin.left + origin.width / 2;
    const y = origin.top + origin.height / 2;
    const colors = pick(palettes);
    const main = makeEffect(effect, x, y, colors);
    const encore = full && Math.random() < .28
      ? makeEffect(pick(['glimmer', 'petals', 'mini-orbit', 'waypoints']), x, y, colors)
      : null;
    const encoreDelay = between(.48, .8);
    run(encore ? 2800 : 2250, (elapsed) => {
      main(elapsed);
      if (elapsed >= encoreDelay) encore?.(elapsed - encoreDelay);
    });
  }
  if (!muted) playTune(full);
}

export function playOpening() {
  if (reducedMotion.matches) return;
  const bounds = document.querySelector('.hero').getBoundingClientRect();
  const variant = chooseEffect('opening', openingEffects);
  const colors = pick(palettes);
  if (variant === 'constellation' || variant === 'orbit') {
    const x = bounds.left + bounds.width * .74;
    const y = bounds.top + bounds.height * .45;
    const draw = variant === 'constellation'
      ? constellation(x, y, bounds.width * .34, bounds.height * .36, colors)
      : orbit(x, y, Math.min(bounds.width * .18, bounds.height * .38), colors);
    run(2250, draw);
    return;
  }
  const motes = [];
  if (variant === 'meteor') {
    for (let index = 0; index < 8; index++) {
      motes.push(...burst(bounds.left + bounds.width * (.52 + index * .052), bounds.top + 35 + index * 12, 5, {
        speed: 45, gravity: 0, scale: .53, delay: .2 + index * .085, colors,
      }));
    }
  } else {
    for (let index = 0; index < 27; index++) {
      motes.push({
        x: bounds.left + bounds.width * between(.43, .98), y: bounds.top + bounds.height * between(.15, .86),
        vx: between(-14, 14), vy: variant === 'fireflies' ? between(-34, -8) : 2, gravity: 0,
        size: between(1.1, 3.2), spin: 0, color: pick(colors), shape: variant === 'fireflies' ? 'dot' : 'star',
        life: between(.45, 1.2), delay: between(.15, .8),
      });
    }
  }
  run(2050, (elapsed) => motes.forEach((mote) => particle(mote, elapsed)));
}
