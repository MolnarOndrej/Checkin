const tint = (hex, opacity) => hex + Math.round(255 * Math.max(0, Math.min(1, opacity)))
  .toString(16).padStart(2, '0');
const mix = (from, to, amount) => from + (to - from) * amount;
const smooth = (t) => t * t * (3 - 2 * t);

const palettes = {
  calm: { accent: '#9bfae2', secondary: '#aaa1ff', spark: '#efbaf4' },
  active: { accent: '#b8a6ff', secondary: '#80e9fa', spark: '#ecaafb' },
  bright: { accent: '#ffb8d6', secondary: '#c59bff', spark: '#ffe2a1' },
  standout: { accent: '#ffd48b', secondary: '#f5a0e4', spark: '#a7fbeb' },
};

export function paletteFor({ count, power }) {
  if (power > .58) return palettes.standout;
  if (count >= 3) return palettes.bright;
  return count ? palettes.active : palettes.calm;
}

function mixColor(first, second, fraction) {
  let hex = '#';
  for (let channel = 1; channel < 7; channel += 2) {
    const a = parseInt(first.slice(channel, channel + 2), 16);
    const b = parseInt(second.slice(channel, channel + 2), 16);
    hex += Math.round(mix(a, b, fraction)).toString(16).padStart(2, '0');
  }
  return hex;
}

export function blendPalettes(first, second, fraction) {
  return {
    accent: mixColor(first.accent, second.accent, fraction),
    secondary: mixColor(first.secondary, second.secondary, fraction),
    spark: mixColor(first.spark, second.spark, fraction),
  };
}

const ambient = [palettes.calm, palettes.active, palettes.bright, palettes.standout];

export function driftPalette(base, now) {
  const phase = (now / 9200) % ambient.length;
  const index = Math.floor(phase);
  const light = blendPalettes(ambient[index], ambient[(index + 1) % ambient.length], smooth(phase - index));
  return blendPalettes(base, light, .56);
}

const durations = [3300, 3300, 3300, 3850, 3450, 4100, 3900, 3900];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function randomWave(center, visibleDays, today, now) {
  const choice = Math.random() * durations.length;
  const kind = Math.floor(choice);
  const variation = choice - kind;
  const direction = kind < 3 || variation < .5 ? 1 : -1;
  const side = (variation * 4) % 2 < 1 ? -1 : 1;
  const anchor = Math.abs(today - center) <= visibleDays * .43 ? today : Math.round(center);
  const reach = visibleDays / 2 + 9;
  return {
    kind, direction, side, anchor, started: now, duration: durations[kind],
    from: center - direction * reach, to: center + direction * reach,
  };
}

const head = (day, direction, color, strength = 1, tail = 4) => ({ day, direction, color, strength, tail });

function roomFor(y, height, sign, amount) {
  const room = sign < 0 ? y - height * .07 : height * .94 - y;
  return sign * clamp(room, 0, height * amount);
}

function offCurve(day, yAt, height, amount, phase) {
  const y = yAt(day);
  return y + roomFor(y, height, Math.sign(phase), amount) * Math.abs(phase);
}

function weave(wave, yAt, height, amplitude, wavelength, side) {
  return (progress) => {
    const day = mix(wave.from, wave.to, progress);
    const phase = side * Math.sin((day - wave.anchor) * Math.PI / wavelength);
    return { day, y: offCurve(day, yAt, height, amplitude, phase) };
  };
}

function launch(wave, yAt, height) {
  const arrival = .34;
  const anchorY = yAt(wave.anchor);
  return (progress) => {
    if (progress < arrival) {
      const fall = progress / arrival;
      const y = mix(wave.side < 0 ? -.14 * height : 1.14 * height, anchorY, fall ** 1.24);
      const day = wave.anchor - wave.direction * .6 * Math.sin(Math.PI * fall);
      return { day, y };
    }
    const exit = (progress - arrival) / (1 - arrival);
    const day = mix(wave.anchor, wave.to, exit ** 1.45);
    const phase = -wave.side * Math.sin(Math.PI * Math.min(1, exit * 2.6));
    return { day, y: offCurve(day, yAt, height, .18, phase) };
  };
}

function hops(wave, yAt, height) {
  return (progress) => {
    const day = mix(wave.from, wave.to, progress);
    const interval = 3;
    const step = Math.floor((day - wave.anchor) / interval);
    const start = wave.anchor + step * interval;
    const fraction = (day - start) / interval;
    const y = mix(yAt(start), yAt(start + interval), smooth(fraction));
    const sign = wave.side * (step % 2 === 0 ? 1 : -1);
    const lift = roomFor(y, height, sign, .27) * Math.sin(Math.PI * fraction);
    return { day, y: y + lift };
  };
}

function pause(wave, progress, colors) {
  const { from, to, anchor, direction } = wave;
  const arrives = .34;
  const leaves = .68;
  if (progress <= arrives) {
    return { heads: [head(mix(from, anchor, 1 - (1 - progress / arrives) ** 1.4), direction, colors.spark)] };
  }
  if (progress >= leaves) {
    return { heads: [head(mix(anchor, to, ((progress - leaves) / (1 - leaves)) ** 1.3), direction, colors.spark)] };
  }
  const time = (progress - arrives) / (leaves - arrives);
  return {
    pulses: [-1, 0, 1].map((offset, order) => ({
      day: anchor + direction * offset,
      strength: Math.sin(Math.PI * clamp((time - order * .18) / .63, 0, 1)) ** 2,
      color: [colors.secondary, colors.spark, colors.accent][order],
    })),
  };
}

function ribbon(route, progress, options) {
  const tail = options.tail ?? .19;
  const start = Math.max(0, progress - tail);
  const segments = 40;
  const points = Array.from({ length: segments + 1 }, (_, index) => route(mix(start, progress, index / segments)));
  return { points, ...options };
}

function traversalAt(wave, now, colors, yAt, height) {
  if (!wave) return {};
  const progress = (now - wave.started) / wave.duration;
  if (progress < 0 || progress >= 1) return {};
  const { from, to, direction } = wave;

  switch (wave.kind) {
    case 0:
      return { heads: [head(mix(from, to, progress), direction, colors.accent, 1, 5.7)] };
    case 1:
      return { heads: [head(mix(to, from, progress), -direction, colors.secondary, 1, 2.9)] };
    case 2:
      return {
        heads: [
          head(mix(from, to, progress), direction, colors.secondary, .85, 3.2),
          head(mix(to, from, progress), -direction, colors.spark, .82, 3.2),
        ],
      };
    case 3:
      return { ribbons: [ribbon(weave(wave, yAt, height, .31, 5, wave.side), progress, {
        color: colors.accent, tip: colors.spark, width: 3.1, tail: .25,
      })] };
    case 4:
      return { ribbons: [ribbon(launch(wave, yAt, height), progress, {
        color: colors.spark, tip: colors.accent, width: 3.6, tail: .22,
      })] };
    case 5:
      return pause(wave, progress, colors);
    case 6:
      return { ribbons: [ribbon(hops(wave, yAt, height), progress, {
        color: colors.secondary, tip: colors.spark, width: 2, tail: .16, beads: true,
      })] };
    case 7:
      return {
        ribbons: [
          ribbon(weave(wave, yAt, height, .21, 6, wave.side), progress, {
            color: colors.accent, tip: colors.accent, width: 2.6, tail: .25,
          }),
          ribbon(weave(wave, yAt, height, .29, 6, -wave.side), progress, {
            color: colors.spark, tip: colors.secondary, width: 2.15, tail: .19,
          }),
        ],
      };
    default:
      return {};
  }
}

function rippleHeads(ripple, now, colors) {
  if (!ripple) return [];
  const progress = (now - ripple.started) / 1050;
  if (progress < 0 || progress >= 1) return [];
  const spread = 4.2 * (1 - (1 - progress) ** 2);
  return [-1, 1].map((direction) => ({
    day: ripple.index + direction * spread,
    direction,
    color: direction === 1 ? colors.accent : colors.spark,
    strength: (1 - progress) ** 1.4,
    tail: 1.5,
  }));
}

function trace(points) {
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const step = (b.x - a.x) / 3;
    path.bezierCurveTo(a.x + step, a.y, b.x - step, b.y, b.x, b.y);
  }
  return path;
}

function stroke(context, path, color, width) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke(path);
}

function circle(context, x, y, size) {
  context.beginPath();
  context.arc(x, y, size, 0, 2 * Math.PI);
}

function halo(context, x, y, radius, color, brightness) {
  const light = context.createRadialGradient(x, y, 0, x, y, radius);
  light.addColorStop(0, tint(color, brightness));
  light.addColorStop(.35, tint(color, brightness * .47));
  light.addColorStop(1, tint(color, 0));
  context.fillStyle = light;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function lineWave(context, path, head, worldToX, spacing) {
  const x = worldToX(head.day);
  const back = x - head.direction * head.tail * spacing;
  const front = x + head.direction * .75 * spacing;
  const gradient = (opacity) => {
    const color = context.createLinearGradient(back, 0, front, 0);
    color.addColorStop(0, tint(head.color, 0));
    color.addColorStop(.5, tint(head.color, opacity * .24));
    color.addColorStop(head.tail / (head.tail + .75), tint(head.color, opacity));
    color.addColorStop(1, tint(head.color, 0));
    return color;
  };

  stroke(context, path, gradient(.055 * head.strength), 24);
  stroke(context, path, gradient(.14 * head.strength), 9);
  stroke(context, path, gradient(.91 * head.strength), 2.7);
}

function paintRibbon(context, ribbon, worldToX, width, height) {
  const { points, color, tip, width: thickness, beads } = ribbon;
  const pixels = points.map(({ day, y }) => ({ x: worldToX(day), y }));
  if (pixels.every(({ x }) => x < -64) || pixels.every(({ x }) => x > width + 64)) return;
  const first = pixels[0];
  const last = pixels.at(-1);
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1) return;
  const path = new Path2D();
  path.moveTo(first.x, first.y);
  for (let index = 1; index < pixels.length - 1; index++) {
    const { x, y } = pixels[index];
    const next = pixels[index + 1];
    path.quadraticCurveTo(x, y, (x + next.x) / 2, (y + next.y) / 2);
  }
  path.lineTo(last.x, last.y);
  const gradient = (opacity) => {
    const light = context.createLinearGradient(first.x, first.y, last.x, last.y);
    light.addColorStop(0, tint(color, 0));
    light.addColorStop(.48, tint(color, opacity * .39));
    light.addColorStop(.88, tint(color, opacity * .85));
    light.addColorStop(1, tint(tip, opacity));
    return light;
  };
  stroke(context, path, gradient(.035), 42);
  stroke(context, path, gradient(.075), 25);
  stroke(context, path, gradient(.20), 11);
  stroke(context, path, gradient(.96), thickness);
  if (beads) {
    for (const fraction of [.43, .65, .83]) {
      const { x, y } = pixels[Math.round(fraction * (pixels.length - 1))];
      halo(context, x, y, 8, tip, fraction * .3);
      circle(context, x, y, 1.3);
      context.fillStyle = tint(tip, fraction);
      context.fill();
    }
  }
  if (last.y > -24 && last.y < height + 24) {
    halo(context, last.x, last.y, 27, tip, .57);
    circle(context, last.x, last.y, thickness * .78);
    context.fillStyle = tint('#ffffff', .88);
    context.fill();
  }
}

function drawPoints(context, points, heads, colors, today, selected, width) {
  for (const point of points) {
    if (point.x < -48 || point.x > width + 48) continue;
    const { x, y, index, power, count } = point;
    const current = index === today;
    const chosen = index === selected;
    const future = index > today;
    const size = 3 + (current || chosen ? 1.65 : 0) + (count ? .85 : 0) + power * 3.1;
    const color = power > .58 ? colors.spark : count || current || chosen ? colors.accent : colors.secondary;

    if (current || count || chosen) {
      halo(context, x, y, 13 + power * 16, color, .17 + .19 * power);
    }
    for (const head of heads) {
      const distance = index - head.day;
      const rise = head.y === undefined ? 0 : (y - head.y) / 36;
      const charge = Math.exp(-(distance ** 2) / (.53 + power * .75) - rise ** 2) * head.strength;
      if (charge < .015) continue;
      halo(context, x, y, 24 + power * 29, head.color, charge * (.3 + .42 * power));
      circle(context, x, y, size + 1 + charge * (2 + power * 6));
      context.strokeStyle = tint(head.color, charge * (.28 + .31 * power));
      context.lineWidth = 1 + power;
      context.stroke();
    }

    if (current || chosen) {
      circle(context, x, y, size + 5);
      context.strokeStyle = tint(color, chosen ? .74 : .41);
      context.lineWidth = 1;
      context.stroke();
    }

    circle(context, x, y, size);
    context.fillStyle = tint(color, future ? .37 : count || current || chosen ? .99 : .66);
    context.fill();
    if (current || power > .58) {
      circle(context, x - .42, y - .42, Math.max(1.2, size * .43));
      context.fillStyle = tint('#ffffff', .84);
      context.fill();
    }
  }
}

function waveTip(context, yAt, head, worldToX, width) {
  const x = worldToX(head.day);
  if (x < -20 || x > width + 20) return;
  const y = yAt(head.day);
  halo(context, x, y, 19, head.color, head.strength * .52);
  circle(context, x, y, 1.8 + head.strength * .9);
  context.fillStyle = tint('#ffffff', head.strength * .91);
  context.fill();
}

export function paintGraph(canvas, frame) {
  const { width, height, ratio, points, pointAt, colors, today, selected, baseline, spacing, wave, ripple, now } = frame;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const first = points[0];
  const worldToX = (index) => first.x + (index - first.index) * spacing;
  const yAt = (day) => {
    const left = Math.floor(day);
    return mix(pointAt(left).y, pointAt(left + 1).y, smooth(day - left));
  };
  const effects = traversalAt(wave, now, colors, yAt, height);
  const heads = [...(effects.heads ?? []), ...rippleHeads(ripple, now, colors)];
  const ribbons = effects.ribbons ?? [];
  const contacts = ribbons.map(({ points: trail, tip }) => ({ ...trail.at(-1), color: tip, strength: .92 }));
  const path = trace(points);

  const axis = new Path2D();
  axis.moveTo(0, baseline + .5);
  axis.lineTo(width, baseline + .5);
  context.lineCap = 'butt';
  context.setLineDash([1, 7]);
  stroke(context, axis, tint(colors.secondary, .22), 1);
  context.setLineDash([]);

  const centerX = worldToX(today);
  if (centerX >= 0 && centerX <= width) {
    const guide = new Path2D();
    guide.moveTo(centerX + .5, height * .11);
    guide.lineTo(centerX + .5, height * .92);
    const light = context.createLinearGradient(0, height * .11, 0, height * .92);
    light.addColorStop(0, tint(colors.accent, 0));
    light.addColorStop(.7, tint(colors.accent, .19));
    light.addColorStop(1, tint(colors.accent, 0));
    stroke(context, guide, light, 1);
  }

  const filament = context.createLinearGradient(0, 0, width, 0);
  filament.addColorStop(0, tint(colors.secondary, .22));
  filament.addColorStop(.35, tint(colors.secondary, .68));
  filament.addColorStop(.51, tint(colors.accent, .73));
  filament.addColorStop(.72, tint(colors.accent, .51));
  filament.addColorStop(1, tint(colors.secondary, .21));
  context.lineCap = 'round';
  stroke(context, path, tint(colors.secondary, .065), 18);
  stroke(context, path, tint(colors.accent, .13), 6);
  stroke(context, path, filament, 1.8);

  for (const head of heads) lineWave(context, path, head, worldToX, spacing);
  for (const ribbon of ribbons) paintRibbon(context, ribbon, worldToX, width, height);
  for (const pulse of effects.pulses ?? []) {
    if (pulse.strength < .035) continue;
    const x = worldToX(pulse.day);
    const y = yAt(pulse.day);
    halo(context, x, y, 38 + pulse.strength * 12, pulse.color, pulse.strength * .64);
    circle(context, x, y, 12 + pulse.strength * 14);
    context.strokeStyle = tint(pulse.color, pulse.strength * .65);
    context.lineWidth = 1.45;
    context.stroke();
  }
  drawPoints(context, points, [...heads, ...contacts, ...(effects.pulses ?? [])], colors, today, selected, width);
  for (const head of heads) waveTip(context, yAt, head, worldToX, width);

  const origin = ripple && points[ripple.index - first.index];
  const age = ripple ? (now - ripple.started) / 520 : 1;
  if (origin && age >= 0 && age < 1) {
    circle(context, origin.x, origin.y, 6 + 35 * (1 - (1 - age) ** 2));
    context.strokeStyle = tint(colors.spark, .67 * (1 - age));
    context.lineWidth = 1.5;
    context.stroke();
  }
}
