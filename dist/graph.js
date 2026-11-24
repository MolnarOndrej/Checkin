const tint = (hex, opacity) => hex + Math.round(255 * Math.max(0, Math.min(1, opacity)))
  .toString(16).padStart(2, '0');
const mix = (from, to, amount) => from + (to - from) * amount;
const smooth = (t) => t * t * (3 - 2 * t);

export const palettes = {
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

export function waveFor(pattern, center, visibleDays, now) {
  return { pattern, center, reach: visibleDays / 2 + 9, started: now };
}

function waveHeads(wave, now, colors) {
  if (!wave) return [];
  const progress = (now - wave.started) / 3300;
  if (progress < 0 || progress >= 1) return [];
  const { center, reach } = wave;
  if (wave.pattern === 2) {
    const inward = 1 - 2 * progress;
    return [
      { day: center - reach * inward, direction: 1, color: colors.secondary, strength: .85, tail: 3.2 },
      { day: center + reach * inward, direction: -1, color: colors.spark, strength: .82, tail: 3.2 },
    ];
  }

  const direction = wave.pattern === 0 ? 1 : -1;
  const day = center + direction * mix(-reach, reach, progress);
  return [{
    day, direction,
    color: direction === 1 ? colors.accent : colors.secondary,
    strength: 1,
    tail: direction === 1 ? 5.7 : 2.9,
  }];
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

function drawPoints(context, points, heads, colors, today, selected, width) {
  for (const point of points) {
    if (point.x < -48 || point.x > width + 48) continue;
    const { x, y, index, power, count } = point;
    const current = index === today;
    const chosen = index === selected;
    const future = index > today;
    const size = 2.7 + (current || chosen ? 1.45 : 0) + (count ? .7 : 0) + power * 2.85;
    const color = power > .58 ? colors.spark : count || current || chosen ? colors.accent : colors.secondary;

    if (current || count || chosen) {
      halo(context, x, y, 13 + power * 16, color, .17 + .19 * power);
    }
    for (const head of heads) {
      const distance = index - head.day;
      const charge = Math.exp(-(distance ** 2) / (.53 + power * .75)) * head.strength;
      if (charge < .015) continue;
      halo(context, x, y, 22 + power * 29, head.color, charge * (.27 + .42 * power));
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

function waveTip(context, points, head, worldToX, width) {
  const x = worldToX(head.day);
  if (x < -20 || x > width + 20) return;
  const offset = head.day - points[0].index;
  const a = points[Math.floor(offset)];
  const b = points[Math.ceil(offset)];
  if (!a || !b) return;
  const y = mix(a.y, b.y, smooth(offset % 1));
  halo(context, x, y, 19, head.color, head.strength * .52);
  circle(context, x, y, 1.8 + head.strength * .9);
  context.fillStyle = tint('#ffffff', head.strength * .91);
  context.fill();
}

export function paintGraph(canvas, frame) {
  const { width, height, ratio, points, colors, today, selected, baseline, spacing, wave, ripple, now } = frame;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const first = points[0];
  const worldToX = (index) => first.x + (index - first.index) * spacing;
  const heads = [...waveHeads(wave, now, colors), ...rippleHeads(ripple, now, colors)];
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
  stroke(context, path, tint(colors.secondary, .065), 15);
  stroke(context, path, tint(colors.accent, .11), 5);
  stroke(context, path, filament, 1.45);

  for (const head of heads) lineWave(context, path, head, worldToX, spacing);
  drawPoints(context, points, heads, colors, today, selected, width);
  for (const head of heads) waveTip(context, points, head, worldToX, width);

  const origin = ripple && points[ripple.index - first.index];
  const age = ripple ? (now - ripple.started) / 520 : 1;
  if (origin && age >= 0 && age < 1) {
    circle(context, origin.x, origin.y, 6 + 35 * (1 - (1 - age) ** 2));
    context.strokeStyle = tint(colors.spark, .67 * (1 - age));
    context.lineWidth = 1.5;
    context.stroke();
  }
}
