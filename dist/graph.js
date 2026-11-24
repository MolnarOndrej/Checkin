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

const effects = [
  ['daybreak-sweep', 3300],
  ['backlight-sweep', 3300],
  ['crossing-lights', 3300],
  ['over-under', 3850],
  ['sky-ribbon', 3950],
  ['split-pulse', 4100],
  ['skipping-sparks', 3900],
  ['twin-ribbons', 3900],
  ['beacon-landing', 4400],
];
const paletteColors = ['accent', 'secondary', 'spark'];
const borders = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const inkFade = 1050;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function randomWave({ center, visibleDays, today, now, countAt }) {
  const choice = Math.random() * effects.length;
  const index = Math.floor(choice);
  const [kind, duration] = effects[index];
  const variation = choice - index;
  let direction = index < 3 || variation < .5 ? 1 : -1;
  const side = (variation * 4) % 2 < 1 ? -1 : 1;
  const ink = Math.random() < .3 ? paletteColors[Math.floor(Math.random() * paletteColors.length)] : null;
  const radius = Math.max(.5, visibleDays / 2 - .35);
  const first = Math.ceil(center - radius);
  const last = Math.floor(center + radius);
  const reach = visibleDays / 2 + 9;
  let anchor = Math.abs(today - center) <= visibleDays * .43 ? today : Math.round(center);
  let entry;
  if (kind === 'sky-ribbon') {
    anchor = first + Math.floor(Math.random() * (last - first + 1));
  } else if (kind === 'beacon-landing') {
    anchor = Math.round(center);
    for (let day = first; day <= last; day++) {
      const difference = countAt(day) - countAt(anchor);
      if (difference > 0 || (difference === 0 && Math.abs(day - center) < Math.abs(anchor - center))) anchor = day;
    }
    const [x, y] = borders[Math.floor(Math.random() * borders.length)];
    entry = { day: x ? center + reach * x : mix(first, last, Math.random()), y };
  }
  if ((kind === 'sky-ribbon' || kind === 'beacon-landing') && anchor !== center) direction = Math.sign(center - anchor);
  return {
    kind, direction, side, anchor, entry, ink, started: now, duration,
    ends: now + duration + (ink ? inkFade : 0),
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
  const time = clamp((progress - arrives) / (leaves - arrives), 0, 1);
  const outward = clamp((progress - leaves) / (1 - leaves), 0, 1);
  const reach = 1.08 * (1 - (1 - time) ** 2.2);
  return {
    heads: [-1, 1].map((side) => {
      const day = mix(anchor + side * reach, side === direction ? to : from, outward ** 1.55);
      return {
        ...head(day, side, colors.spark, mix(.70 + .18 * Math.sin(Math.PI * time), 1, outward), mix(1.2, 4, outward)),
        lead: mix(.32, .75, outward),
        trailOpacity: mix(.66, .24, outward),
      };
    }),
  };
}

function landBall(wave, progress, color, yAt, height, complete, trailStart) {
  const { anchor, side, to, entry } = wave;
  const approach = .33;
  const expanded = .49;
  const landed = .7;
  const radius = 4.5;
  const large = clamp(height * .135, 42, 88);
  const nodeY = yAt(anchor);
  let lift = roomFor(nodeY, height, side, .27);
  if (Math.abs(lift) < height * .19) lift = roomFor(nodeY, height, -side, .27);
  const hover = nodeY + lift;

  const startY = entry.y ? height * (entry.y < 0 ? -.14 : 1.14) : hover + lift * .26;
  const hoverTime = expanded - approach;
  // Hold the trail in place while the beacon hovers.
  const travelTime = (time) => time - clamp(time - approach, 0, hoverTime);
  const route = (time) => {
    if (time <= approach) {
      const arrival = 1 - (1 - time / approach) ** 1.6;
      return { day: mix(entry.day, anchor, arrival), y: mix(startY, hover, arrival) };
    }
    const phase = time + hoverTime;
    if (phase < landed) {
      const descent = (phase - expanded) / (landed - expanded);
      return { day: anchor, y: mix(hover, nodeY, smooth(descent)) };
    }
    const exit = (phase - landed) / (1 - landed);
    const day = mix(anchor, to, exit ** 1.28);
    return { day, y: yAt(day) };
  };
  const position = travelTime(progress);
  const ball = { ...route(position), radius, color, strength: 1, bloomRadius: large, bloom: 0 };
  if (progress >= approach && progress < expanded) {
    const gathering = smooth((progress - approach) / (expanded - approach));
    ball.bloomRadius = mix(24, large, gathering);
    ball.bloom = gathering;
  } else if (progress >= expanded && progress < landed) {
    const descent = (progress - expanded) / (landed - expanded);
    ball.bloom = 1 - smooth(clamp((descent - .26) / .74, 0, 1));
  }
  const exit = clamp((progress - landed) / (1 - landed), 0, 1);
  const start = Math.max(travelTime(trailStart), position - mix(.12, .05, smooth(exit)));
  const ribbons = complete ? beaconTrail(route, start, position, [approach, travelTime(landed)], color) : [];
  return { ball, ribbons };
}

function beaconTrail(route, start, end, turns, color) {
  if (end <= start) return [];
  // Give each leg its own gradient so the tail stays visible when the beacon doubles back.
  const stops = [start, ...turns.filter((turn) => start < turn && turn < end), end];
  const fadeAt = (time) => (time - start) / (end - start);
  return stops.slice(1).map((stop, index) => {
    const from = stops[index];
    return ribbon(route, stop, {
      color, tip: color, width: 2.6, tail: stop - from, quietTip: true, fade: [fadeAt(from), fadeAt(stop)],
    }, true, from);
  });
}

function ribbon(route, progress, options, complete, trailStart = 0) {
  const tail = options.tail ?? .19;
  const start = Math.max(trailStart, progress - tail);
  const segments = 40;
  const points = complete
    ? Array.from({ length: segments + 1 }, (_, index) => route(mix(start, progress, index / segments)))
    : [route(progress)];
  return { points, ...options };
}

function traversalAt(wave, now, colors, yAt, height, { complete = true, after } = {}) {
  if (!wave) return {};
  const progress = (now - wave.started) / wave.duration;
  if (progress < 0 || progress >= 1) return {};
  const { from, to, direction } = wave;
  const trailStart = after === undefined ? 0 : clamp((after - wave.started) / wave.duration, 0, progress);
  const drawRibbon = (route, options) => ribbon(route, progress, options, complete, trailStart);

  switch (wave.kind) {
    case 'daybreak-sweep':
      return { heads: [head(mix(from, to, progress), direction, colors.accent, 1, 5.7)] };
    case 'backlight-sweep':
      return { heads: [head(mix(to, from, progress), -direction, colors.secondary, 1, 2.9)] };
    case 'crossing-lights':
      return {
        heads: [
          head(mix(from, to, progress), direction, colors.secondary, .85, 3.2),
          head(mix(to, from, progress), -direction, colors.spark, .82, 3.2),
        ],
      };
    case 'over-under':
      return { ribbons: [drawRibbon(weave(wave, yAt, height, .31, 5, wave.side), {
        color: colors.accent, tip: colors.spark, width: 3.1, tail: .25,
      })] };
    case 'sky-ribbon':
      return { ribbons: [drawRibbon(launch(wave, yAt, height), {
        color: colors.spark, tip: colors.accent, width: 3.6, tail: .22,
      })] };
    case 'split-pulse':
      return pause(wave, progress, colors);
    case 'skipping-sparks':
      return { ribbons: [drawRibbon(hops(wave, yAt, height), {
        color: colors.secondary, tip: colors.spark, width: 2, tail: .16, beads: true,
      })] };
    case 'twin-ribbons':
      return {
        ribbons: [
          drawRibbon(weave(wave, yAt, height, .21, 6, wave.side), {
            color: colors.accent, tip: colors.accent, width: 2.6, tail: .25,
          }),
          drawRibbon(weave(wave, yAt, height, .29, 6, -wave.side), {
            color: colors.spark, tip: colors.secondary, width: 2.15, tail: .19,
          }),
        ],
      };
    case 'beacon-landing':
      return landBall(wave, progress, colors.spark, yAt, height, complete, trailStart);
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
  const lead = head.lead ?? .75;
  const front = x + head.direction * lead * spacing;
  const peak = Math.max(.001, head.tail / (head.tail + lead));
  const gradient = (opacity) => {
    const color = context.createLinearGradient(back, 0, front, 0);
    color.addColorStop(0, tint(head.color, 0));
    color.addColorStop(.5, tint(head.color, opacity * (head.trailOpacity ?? .24)));
    color.addColorStop(peak, tint(head.color, opacity));
    color.addColorStop(1, tint(head.color, 0));
    return color;
  };

  stroke(context, path, gradient(.055 * head.strength), 24);
  stroke(context, path, gradient(.14 * head.strength), 9);
  stroke(context, path, gradient(.91 * head.strength), 2.7);
}

function ribbonTips(ribbons = []) {
  return ribbons.filter(({ quietTip }) => !quietTip)
    .map(({ points, tip, opacity = 1 }) => ({ ...points.at(-1), color: tip, strength: .92 * opacity }));
}

function inkOnGraph(wave, now, colors, yAt, height) {
  if (!wave?.ink) return null;
  const marks = [];
  const visitStart = wave.started + (wave.visit?.begin ?? 0);
  const earliest = wave.visit?.delay > 0 && now >= visitStart ? visitStart + wave.visit.delay : wave.started;
  for (let age = 0; age < inkFade && now - age >= earliest; age += 20) {
    const frame = waveFrameAt(wave, now - age);
    const { heads = [], ribbons, ball } = traversalAt(wave, frame.time, colors, yAt, height, { complete: false });
    const contacts = [...heads, ...ribbonTips(ribbons)];
    if (ball && !heads.length) contacts.push(ball);
    for (const { day, y, strength } of contacts) {
      const distance = y === undefined ? 0 : (y - yAt(day)) / 18;
      const brightness = Math.exp(-(distance ** 2)) * strength * (1 - age / inkFade) ** 1.35;
      if (brightness > .025) marks.push({ day, brightness });
    }
  }
  if (!marks.length) return null;
  return {
    color: colors.accent,
    at(day) {
      let strength = 0;
      for (const mark of marks) {
        const distance = Math.abs(mark.day - day);
        if (distance < .51) strength = Math.max(strength, mark.brightness * smooth(1 - distance / .51));
      }
      return strength;
    },
  };
}

function paintInk(context, path, ink, firstDay, width, spacing) {
  if (!ink) return;
  const gradient = context.createLinearGradient(0, 0, width, 0);
  const steps = Math.ceil(width / spacing * 9);
  for (let step = 0; step <= steps; step++) {
    const position = step / steps;
    const strength = ink.at(firstDay + position * width / spacing);
    gradient.addColorStop(position, tint(ink.color, Math.min(1, strength * 1.15)));
  }
  context.save();
  context.globalAlpha = .2;
  stroke(context, path, gradient, 14);
  context.globalAlpha = 1;
  stroke(context, path, gradient, 2.65);
  context.restore();
}

function paintBall(context, ball, worldToX, width, height) {
  const { y, radius, color, bloom, bloomRadius } = ball;
  const x = worldToX(ball.day);
  const glow = radius * 2.8 + 11;
  const extent = bloom > 0 ? bloomRadius : glow;
  if (x < -extent || x > width + extent || y < -extent || y > height + extent) return;
  if (bloom > 0) halo(context, x, y, bloomRadius, color, bloom * .92);
  halo(context, x, y, glow, color, .64);
  const core = context.createRadialGradient(x, y, 0, x, y, radius);
  core.addColorStop(0, tint('#ffffff', .97));
  core.addColorStop(.36, tint(color, .94));
  core.addColorStop(1, tint(color, .13));
  circle(context, x, y, radius);
  context.fillStyle = core;
  context.fill();
  context.strokeStyle = tint(color, .39);
  context.lineWidth = 1;
  context.stroke();
}

function paintTrailTip(context, { x, y }, { tip, width, quietTip, opacity = 1 }, height) {
  if (quietTip || opacity <= 0 || y <= -24 || y >= height + 24) return;
  halo(context, x, y, 27, tip, .57 * opacity);
  circle(context, x, y, width * .78);
  context.fillStyle = tint('#ffffff', .88 * opacity);
  context.fill();
}

function paintTrail(context, pixels, style, width, height) {
  const { color, tip, width: thickness, beads, fade, opacity = 1 } = style;
  if (pixels.every(({ x }) => x < -64) || pixels.every(({ x }) => x > width + 64)) return;
  const first = pixels[0];
  const last = pixels.at(-1);
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1) {
    paintTrailTip(context, last, style, height);
    return;
  }
  const path = new Path2D();
  path.moveTo(first.x, first.y);
  for (let index = 1; index < pixels.length - 1; index++) {
    const { x, y } = pixels[index];
    const next = pixels[index + 1];
    path.quadraticCurveTo(x, y, (x + next.x) / 2, (y + next.y) / 2);
  }
  path.lineTo(last.x, last.y);
  const gradient = (lightness) => {
    const light = context.createLinearGradient(first.x, first.y, last.x, last.y);
    const intensity = (position, fallback) => opacity * lightness * (fade ? mix(...fade, position) ** 1.35 : fallback);
    light.addColorStop(0, tint(color, intensity(0, 0)));
    light.addColorStop(.48, tint(color, intensity(.48, .39)));
    light.addColorStop(.88, tint(color, intensity(.88, .85)));
    light.addColorStop(1, tint(tip, intensity(1, 1)));
    return light;
  };
  stroke(context, path, gradient(.035), 42);
  stroke(context, path, gradient(.075), 25);
  stroke(context, path, gradient(.20), 11);
  stroke(context, path, gradient(.96), thickness);
  if (beads) {
    for (const fraction of [.43, .65, .83]) {
      const { x, y } = pixels[Math.round(fraction * (pixels.length - 1))];
      halo(context, x, y, 8, tip, fraction * .3 * opacity);
      circle(context, x, y, 1.3);
      context.fillStyle = tint(tip, fraction * opacity);
      context.fill();
    }
  }
  paintTrailTip(context, last, style, height);
}

function paintRibbon(context, ribbon, worldToX, width, height) {
  const pixels = ribbon.points.map(({ day, y }) => ({ x: worldToX(day), y }));
  paintTrail(context, pixels, ribbon, width, height);
}

function drawPoints(context, points, heads, colors, today, selected, width, ink) {
  for (const point of points) {
    if (point.x < -48 || point.x > width + 48) continue;
    const { x, y, index, power, count } = point;
    const current = index === today;
    const chosen = index === selected;
    const future = index > today;
    const dyed = ink?.at(index) ?? 0;
    const size = 3 + (current || chosen ? 1.65 : 0) + (count ? .85 : 0) + power * 3.1 + dyed * .7;
    const base = power > .58 ? colors.spark : count || current || chosen ? colors.accent : colors.secondary;
    const color = dyed ? mixColor(base, ink.color, Math.min(1, dyed * 1.45)) : base;

    if (current || count || chosen) {
      halo(context, x, y, 13 + power * 16, color, .17 + .19 * power);
    }
    if (dyed > .025) halo(context, x, y, 19 + power * 12, ink.color, dyed * .48);
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
    const opacity = future ? .37 : count || current || chosen ? .99 : .66;
    context.fillStyle = tint(color, opacity + dyed * .4);
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

function leadOf(wave, effects) {
  const contact = effects.ball ?? effects.heads?.[0] ?? ribbonTips(effects.ribbons)[0];
  return contact && { ...contact, direction: contact.direction ?? wave.direction };
}

function planVisit(wave, visit, width, colors, worldToX, yAt, height) {
  const spans = {
    'sky-ribbon': [.36, .9],
    'split-pulse': [.04, .32],
    'beacon-landing': [.71, .93],
  };
  const [first, last] = spans[wave.kind] ?? [.15, .85];
  let closest = Infinity;
  let moment;
  for (let index = 0; index <= 48; index++) {
    const scale = mix(first, last, index / 48);
    const signal = traversalAt(wave, wave.started + scale * wave.duration, colors, yAt, height, { complete: false });
    const lead = leadOf(wave, signal);
    if (!lead) continue;
    const x = worldToX(lead.day);
    const y = visit.stage.top + (lead.y ?? yAt(lead.day));
    if (x < 12 || x > width - 12 || y < 6 || y > innerHeight - 6) continue;
    const sideX = lead.direction > 0 ? visit.panel.left : visit.panel.right;
    const distance = Math.abs(visit.stage.left + x - sideX) + Math.max(0, y - visit.panel.top) * .45;
    if (distance < closest) {
      closest = distance;
      moment = scale;
    }
  }
  if (moment === undefined) return null;
  const delay = 1560;
  const duration = Math.min(4860, wave.duration + 1280) - delay;
  return { begin: moment * duration, duration, delay };
}

function waveFrameAt(wave, now) {
  const visit = wave?.visit;
  if (!visit) return { time: now, loop: null, rejoin: null };
  const elapsed = now - wave.started;
  const intoVisit = elapsed - visit.begin;
  const detouring = intoVisit >= 0 && intoVisit < visit.delay;
  const spentVisiting = clamp(intoVisit, 0, visit.delay);
  const rejoin = visit.delay > 0 && intoVisit >= visit.delay ? {
    time: wave.started + visit.begin * wave.duration / visit.duration,
    age: intoVisit - visit.delay,
  } : null;
  return {
    time: wave.started + (elapsed - spentVisiting) * wave.duration / visit.duration,
    loop: detouring ? intoVisit / visit.delay : null,
    rejoin,
  };
}

function rejoinedHeads(heads, startingHeads, secondaryLight) {
  return heads.map((head, index) => {
    const start = startingHeads.find(({ direction }) => direction === head.direction);
    const tail = start ? clamp((head.day - start.day) * head.direction, 0, head.tail) : head.tail;
    return { ...head, tail, strength: index === 0 ? head.strength : head.strength * secondaryLight };
  });
}

function sampleRim(panel, direction) {
  const gutter = 5;
  const left = panel.left - gutter;
  const right = panel.right + gutter;
  const top = panel.top - gutter;
  const bottom = panel.bottom + gutter;
  const radius = Math.min(19, (right - left) / 2, (bottom - top) / 2);
  const corners = [
    [left + radius, top + radius],
    [right - radius, top + radius],
    [right - radius, bottom - radius],
    [left + radius, bottom - radius],
  ];
  const points = [];
  for (const [corner, [x, y]] of corners.entries()) {
    for (let step = 0; step <= 8; step++) {
      const angle = Math.PI + (corner + step / 8) * Math.PI / 2;
      const edge = x + radius * Math.cos(angle);
      points.push({ x: direction > 0 ? edge : left + right - edge, y: y + radius * Math.sin(angle) });
    }
  }
  points.push(points[0]);
  let length = 0;
  const segments = points.slice(1).map((to, index) => {
    const from = points[index];
    const size = Math.hypot(to.x - from.x, to.y - from.y);
    const segment = { from, to, offset: length, size };
    length += size;
    return segment;
  });
  return (progress) => {
    const distance = progress * length;
    const { from, to, offset, size } = segments.find((segment) => distance < segment.offset + segment.size) ?? segments.at(-1);
    const fraction = size ? clamp((distance - offset) / size, 0, 1) : 0;
    return { x: mix(from.x, to.x, fraction), y: mix(from.y, to.y, fraction) };
  };
}

function cubic(a, b, c, d, t) {
  const rest = 1 - t;
  const coordinate = (key) => rest ** 3 * a[key] + 3 * rest ** 2 * t * b[key] + 3 * rest * t ** 2 * c[key] + t ** 3 * d[key];
  return { x: coordinate('x'), y: coordinate('y') };
}

const loopTrailLength = .19;

function paintVisit(canvas, visit, lead, progress, worldToX, yAt, ratio) {
  canvas.hidden = false;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = context.lineJoin = 'round';

  const { direction, color } = lead;
  const rim = sampleRim(visit.panel, direction);
  const entry = rim(0);
  const origin = { x: visit.stage.left + worldToX(lead.day), y: visit.stage.top + (lead.y ?? yAt(lead.day)) };
  const goesAround = .23;
  const rejoins = .76;
  const route = (position) => {
    if (position < goesAround) {
      return cubic(origin, { x: origin.x + direction * 54, y: origin.y },
        { x: entry.x, y: entry.y + 44 }, entry, position / goesAround);
    }
    if (position < rejoins) return rim((position - goesAround) / (rejoins - goesAround));
    return cubic(entry, { x: entry.x, y: entry.y - 44 },
      { x: origin.x - direction * 54, y: origin.y }, origin, (position - rejoins) / (1 - rejoins));
  };

  const arc = clamp((progress - goesAround) / (rejoins - goesAround), 0, 1);
  if (arc > 0 && progress < 1) {
    const d = new Path2D();
    d.moveTo(entry.x, entry.y);
    const steps = Math.max(1, Math.ceil(arc * 144));
    for (let index = 1; index <= steps; index++) {
      const point = rim(arc * index / steps);
      d.lineTo(point.x, point.y);
    }
    const fade = 1 - smooth(clamp((progress - rejoins) / (1 - rejoins), 0, 1));
    stroke(context, d, tint(color, .13 * fade), 13);
    stroke(context, d, tint(color, .58 * fade), 1.65);
  }
  // The last part of the loop stays attached to the graph as the glow moves on.
  const end = Math.min(1, progress);
  const tail = Math.max(0, progress - loopTrailLength);
  const trail = Array.from({ length: 30 }, (_, index) => route(mix(tail, end, index / 29)));
  const opacity = 1 - smooth(clamp((progress - 1) / loopTrailLength, 0, 1));
  paintTrail(context, trail, { color, tip: color, width: 2.9, quietTip: progress >= 1, opacity }, width, height);
}

export function paintGraph(canvas, frame) {
  const { width, height, ratio, points, pointAt, colors, today, selected, baseline, spacing, wave, ripple, now, visit, drawerGlow } = frame;
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
  const dye = wave?.ink && colors[wave.ink];
  const waveColors = dye ? { accent: dye, secondary: dye, spark: dye } : colors;
  if (wave?.panel && visit && wave.visit === undefined) {
    wave.visit = planVisit(wave, visit, width, waveColors, worldToX, yAt, height);
    if (wave.visit) wave.ends += wave.visit.duration + wave.visit.delay - wave.duration;
  } else if (wave?.visit && !visit) {
    const interrupted = clamp(now - wave.started - wave.visit.begin, 0, wave.visit.delay);
    wave.ends += interrupted - wave.visit.delay;
    wave.visit.delay = interrupted;
  }
  const phase = waveFrameAt(wave, now);
  const looping = phase.loop !== null;
  const effects = traversalAt(wave, phase.time, waveColors, yAt, height, {
    complete: !looping, after: phase.rejoin?.time,
  });
  const atRejoin = phase.rejoin && traversalAt(wave, phase.rejoin.time, waveColors, yAt, height, { complete: false });
  const loopProgress = phase.loop ?? (phase.rejoin ? 1 + phase.rejoin.age / wave.visit.delay : null);
  const lead = visit && loopProgress !== null && loopProgress < 1 + loopTrailLength
    && leadOf(wave, looping ? effects : atRejoin);
  if (lead) paintVisit(drawerGlow, visit, lead, loopProgress, worldToX, yAt, ratio);
  else drawerGlow.hidden = true;
  const onGraph = looping ? {} : effects;
  const ink = inkOnGraph(wave, now, waveColors, yAt, height);
  const secondaryLight = phase.rejoin ? smooth(clamp(phase.rejoin.age / 150, 0, 1)) : 1;
  const graphHeads = atRejoin
    ? rejoinedHeads(onGraph.heads ?? [], atRejoin.heads ?? [], secondaryLight)
    : onGraph.heads ?? [];
  const heads = [...graphHeads, ...rippleHeads(ripple, now, colors)];
  const ribbons = (onGraph.ribbons ?? []).map((ribbon, index) =>
    index === 0 || secondaryLight === 1 ? ribbon : { ...ribbon, opacity: (ribbon.opacity ?? 1) * secondaryLight });
  const contacts = ribbonTips(ribbons);
  if (onGraph.ball && !onGraph.heads) contacts.push(onGraph.ball);
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

  paintInk(context, path, ink, first.index - first.x / spacing, width, spacing);
  for (const head of heads) lineWave(context, path, head, worldToX, spacing);
  for (const ribbon of ribbons) paintRibbon(context, ribbon, worldToX, width, height);
  drawPoints(context, points, [...heads, ...contacts], colors, today, selected, width, ink);
  for (const head of heads) {
    if (head.strength > .025) waveTip(context, yAt, head, worldToX, width);
  }
  if (onGraph.ball) paintBall(context, onGraph.ball, worldToX, width, height);

  const origin = ripple && points[ripple.index - first.index];
  const age = ripple ? (now - ripple.started) / 520 : 1;
  if (origin && age >= 0 && age < 1) {
    circle(context, origin.x, origin.y, 6 + 35 * (1 - (1 - age) ** 2));
    context.strokeStyle = tint(colors.spark, .67 * (1 - age));
    context.lineWidth = 1.5;
    context.stroke();
  }
}
