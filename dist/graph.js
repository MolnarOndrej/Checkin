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
  'daybreak-sweep', 'backlight-sweep', 'crossing-lights', 'over-under', 'sky-ribbon',
  'split-pulse', 'skipping-sparks', 'twin-ribbons', 'beacon-landing',
];
const companionTracks = { 'crossing-lights': 'heads', 'twin-ribbons': 'ribbons' };
const paletteColors = ['accent', 'secondary', 'spark'];
const borders = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const glowFade = 1050;
const inkReach = .51;
const glowSpeedForWidth = (width) => .81 * (width / 1440); // CSS pixels per millisecond.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function randomWave({ center, visibleDays, today, now, countAt }) {
  const choice = Math.random() * effects.length;
  const index = Math.floor(choice);
  const kind = effects[index];
  const variation = choice - index;
  let direction = index < 3 || variation < .5 ? 1 : -1;
  const side = (variation * 4) % 2 < 1 ? -1 : 1;
  const ink = Math.random() < .3 ? paletteColors[Math.floor(Math.random() * paletteColors.length)] : null;
  const radius = Math.max(.5, visibleDays / 2 - .35);
  const first = Math.ceil(center - radius);
  const last = Math.floor(center + radius);
  // Scale the offscreen lead-in to keep the time before the glow enters the viewport consistent.
  const padding = visibleDays * (9 / 21);
  const reach = Math.max(visibleDays / 2 + padding, kind === 'split-pulse' ? splitReach + 1 : 0);
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
    kind, direction, side, anchor, entry, ink, started: now,
    from: center - direction * reach, to: center + direction * reach,
  };
}

const head = (day, direction, color, strength = 1, tail = 4) => ({ day, direction, color, strength, tail });
const effectTop = .07;
const effectBottom = .94;

function roomFor(y, height, sign, amount) {
  const room = sign < 0 ? y - height * effectTop : height * effectBottom - y;
  return sign * clamp(room, 0, height * amount);
}

function offCurve(day, yAt, height, amount, phase) {
  const y = yAt(day);
  return y + roomFor(y, height, Math.sign(phase), amount) * Math.abs(phase);
}

function measurePath(pointAt, steps) {
  // Use cumulative screen distance to sample bends at the same speed as straight sections.
  const distances = [0];
  let previous = pointAt(0);
  for (let step = 1; step <= steps; step++) {
    const point = pointAt(step / steps);
    distances.push(distances.at(-1) + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  const length = distances.at(-1);
  return {
    length,
    distanceAt(position) {
      const step = position * steps;
      const left = Math.floor(step);
      return mix(distances[left], distances[Math.min(left + 1, steps)], step - left);
    },
    positionAt(distance) {
      if (distance <= 0) return 0;
      if (distance >= length) return 1;
      let left = 0;
      let right = steps;
      while (right - left > 1) {
        const middle = Math.floor((left + right) / 2);
        if (distances[middle] <= distance) left = middle;
        else right = middle;
      }
      return (left + (distance - distances[left]) / (distances[right] - distances[left])) / steps;
    },
  };
}

function graphTrack(route, layout, extend = false) {
  const startDay = route(0, layout).day;
  const span = route(1, layout).day - startDay;
  const steps = Math.max(96, Math.ceil(Math.abs(span) * 24));
  const measure = (segment) => measurePath((position) => {
    const { day, y } = route(segment + position, layout);
    return { x: day * layout.spacing, y };
  }, steps);
  const segments = [measure(0)];
  const length = segments[0].length;
  return {
    length,
    // Node crossings use tracks with a linear day coordinate.
    distanceAtDay(day) {
      if (!span) return undefined;
      const position = (day - startDay) / span;
      if (position < 0) return undefined;
      const segment = extend ? Math.min(Math.floor(position), segments.length - 1) : 0;
      const fraction = position - segment;
      if (fraction > 1) return undefined;
      let offset = 0;
      for (let index = 0; index < segment; index++) offset += segments[index].length;
      return offset + segments[segment].distanceAt(fraction);
    },
    at(distance, currentLayout) {
      let segment = 0;
      // A swipe can reveal the continuation of a route beyond its original viewport.
      while (extend && distance > segments[segment].length) {
        distance -= segments[segment].length;
        segment++;
        segments[segment] ??= measure(segment);
      }
      // Draw against the live graph while keeping the timing measured at launch.
      return route(segment + segments[segment].positionAt(distance), currentLayout);
    },
  };
}

const followGraph = (from, to) => (position, { yAt }) => {
  const day = mix(from, to, position);
  return { day, y: yAt(day) };
};

function weave(wave, amplitude, wavelength, side) {
  return (progress, { yAt, height }) => {
    const day = mix(wave.from, wave.to, progress);
    const phase = side * Math.sin((day - wave.anchor) * Math.PI / wavelength);
    return { day, y: offCurve(day, yAt, height, amplitude, phase) };
  };
}

function hops(wave) {
  return (progress, { yAt, height }) => {
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

const rippleReach = 4.2;
const splitReach = Math.round(rippleReach);
const splitFadeInMs = 240;
const beaconHoldMs = 700;
const beaconEaseMs = 65;
const beaconFadeMs = 500;

function easeBeaconTrack(track, speed, { start = false, end = false }) {
  const ease = Math.min(beaconEaseMs * speed, track.length / 2);
  const lead = start ? ease : 0;
  const tail = end ? ease : 0;
  // Each eased end averages half the cruising speed, so it needs twice the time.
  const length = track.length + lead + tail;
  return {
    length,
    at(distance, layout) {
      const remaining = length - distance;
      if (distance < 2 * lead) return track.at(distance ** 2 / (4 * lead), layout);
      if (remaining >= 0 && remaining < 2 * tail) {
        return track.at(track.length - remaining ** 2 / (4 * tail), layout);
      }
      return track.at(distance - lead - (remaining < 0 ? tail : 0), layout);
    },
    distanceAtDay(day) {
      const distance = track.distanceAtDay(day);
      if (distance === undefined) return undefined;
      // Invert the easing so a node lights up at the actual moment of contact.
      if (distance < lead) return 2 * Math.sqrt(distance * lead);
      const remaining = track.length - distance;
      if (remaining < 0) return distance + lead + tail;
      if (remaining < tail) return length - 2 * Math.sqrt(remaining * tail);
      return distance + lead;
    },
  };
}

function prepareWave(wave, layout) {
  const { from, to, anchor, direction, side, entry, speed } = wave;
  const track = (route, extend) => graphTrack(route, layout, extend);
  const across = (start, end) => track(followGraph(start, end), true);
  const together = (tracks) => ({
    tracks, length: Math.max(...tracks.map(({ length }) => length)),
    nodeTracks: tracks.map((track, contact) => ({ track, contact })),
  });
  switch (wave.kind) {
    case 'daybreak-sweep': return together([across(from, to)]);
    case 'backlight-sweep': return together([across(to, from)]);
    case 'crossing-lights': return together([across(from, to), across(to, from)]);
    case 'over-under': return together([track(weave(wave, .31, 5, side), true)]);
    case 'twin-ribbons': return together([
      track(weave(wave, .21, 6, side), true),
      track(weave(wave, .29, 6, -side), true),
    ]);
    case 'skipping-sparks': return together([track(hops(wave), true)]);
    case 'sky-ribbon': {
      const fall = track((position, { yAt, height }) => ({
        day: anchor - direction * .6 * Math.sin(Math.PI * position),
        y: mix(side < 0 ? -.14 * height : 1.14 * height, yAt(anchor), position ** 1.24),
      }));
      const exit = track((position, { yAt, height }) => {
        const day = mix(anchor, to, position);
        const phase = -side * Math.sin(Math.PI * Math.min(1, position * 2.6));
        return { day, y: offCurve(day, yAt, height, .18, phase) };
      }, true);
      const ribbon = {
        length: fall.length + exit.length,
        at(distance, currentLayout) {
          return distance <= fall.length ? fall.at(distance, currentLayout) : exit.at(distance - fall.length, currentLayout);
        },
      };
      return {
        ...together([ribbon]),
        nodeTracks: [{ track: exit, offset: fall.length }],
        visitFrom: fall.length, visitTo: fall.length + exit.length * .9,
      };
    }
    case 'split-pulse': {
      const arrival = track(followGraph(from, anchor));
      const branches = [-1, 1].map((side) => {
        const end = anchor + side * splitReach;
        return {
          side, reach: track(followGraph(anchor, end)),
          exit: across(end, side === direction ? to : from),
        };
      });
      const tracks = branches.map(({ reach }) => reach);
      const ripple = { index: anchor, tracks, distance: Math.max(...tracks.map(({ length }) => length)) };
      const exitStart = arrival.length + ripple.distance + splitFadeInMs * speed;
      const length = exitStart + Math.max(...branches.map(({ exit }) => exit.length));
      const nodeTracks = [{ track: arrival }, ...branches.map(({ exit }, contact) => (
        { track: exit, offset: exitStart, contact }
      ))];
      return { arrival, branches, ripple, exitStart, length, nodeTracks, visitTo: arrival.length * .96 };
    }
    case 'beacon-landing': {
      const arrival = easeBeaconTrack(track((position, currentLayout) => {
        const { hover, nodeY } = beaconHeights(wave, currentLayout);
        const { height } = currentLayout;
        const start = entry.y ? height * (entry.y < 0 ? -.14 : 1.14) : hover + (hover - nodeY) * .26;
        return { day: mix(entry.day, anchor, position), y: mix(start, hover, position) };
      }), speed, { end: true });
      const descent = easeBeaconTrack(track((position, currentLayout) => {
        const { hover, nodeY } = beaconHeights(wave, currentLayout);
        return { day: anchor, y: mix(hover, nodeY, position) };
      }), speed, { start: true, end: true });
      const exit = easeBeaconTrack(across(anchor, to), speed, { start: true });
      const visitFrom = arrival.length + beaconHoldMs * speed + descent.length;
      return {
        arrival, descent, exit, length: visitFrom + exit.length, visitFrom, visitTo: visitFrom + exit.length * .93,
        nodeTracks: [{ track: arrival }, { track: exit, offset: visitFrom }],
      };
    }
  }
}

function splitPulse(wave, motion, distance, colors, layout) {
  const { arrival, branches, ripple, exitStart } = motion;
  if (distance <= arrival.length) {
    return { heads: [head(arrival.at(distance, layout).day, wave.direction, colors.spark)] };
  }
  const outward = distance - arrival.length;
  if (outward < ripple.distance) {
    return { ripple: { ...ripple, progress: outward / ripple.distance } };
  }
  const exitDistance = Math.max(0, distance - exitStart);
  const fade = smooth(clamp((outward - ripple.distance) / (splitFadeInMs * wave.speed), 0, 1));
  const style = clamp(exitDistance / (layout.spacing * 3), 0, 1);
  return {
    heads: branches.map(({ side, exit }) => ({
      ...head(exit.at(exitDistance, layout).day, side, colors.spark, fade * mix(.84, 1, style), mix(1.2, 4, style)),
      lead: mix(.32, .75, style),
      trailOpacity: mix(.66, .24, style),
    })),
  };
}

function beaconHeights({ anchor, side }, { yAt, height }) {
  const large = clamp(height * .135, 42, 88);
  const nodeY = yAt(anchor);
  let lift = roomFor(nodeY, height, side, .27);
  if (Math.abs(lift) < height * .19) lift = roomFor(nodeY, height, -side, .27);
  // Leave room for the full bloom inside the graph's edge fade.
  return { nodeY, hover: clamp(nodeY + lift, height * effectTop + large, height * effectBottom - large), large };
}

function landBall(wave, motion, distance, color, layout, complete, trailStart) {
  const { arrival, descent, exit } = motion;
  const { large } = beaconHeights(wave, layout);
  const holdDistance = beaconHoldMs * wave.speed;
  const approach = arrival.length;
  const expanded = approach + holdDistance;
  const landed = approach + descent.length;
  // Keep the trail at the same location while the beacon hovers.
  const traveled = (value) => value - clamp(value - approach, 0, holdDistance);
  const route = (position) => {
    if (position <= approach) return arrival.at(position, layout);
    if (position < landed) return descent.at(position - approach, layout);
    return exit.at(position - landed, layout);
  };
  const position = traveled(distance);
  const gathering = smooth(clamp((distance - approach) / holdDistance, 0, 1));
  const fading = smooth(clamp((distance - expanded) / (descent.length + beaconFadeMs * wave.speed), 0, 1));
  const bloom = gathering * (1 - fading);
  const ball = {
    ...route(position), radius: mix(4.5, 8, bloom), color, strength: 1, bloom,
    bloomRadius: mix(24, large, bloom),
  };
  const leaving = clamp((position - landed) / exit.length, 0, 1);
  const movingLength = landed + exit.length;
  const start = Math.max(traveled(trailStart), position - movingLength * mix(.12, .05, smooth(leaving)));
  const ribbons = complete ? beaconTrail(route, start, position, [approach, landed], color) : [];
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

function ribbon(route, distance, options, complete, trailStart) {
  const start = Math.max(trailStart, distance - options.tail);
  const segments = 40;
  const points = complete
    ? Array.from({ length: segments + 1 }, (_, index) => route(mix(start, distance, index / segments)))
    : [route(distance)];
  return { points, ...options };
}

function traversalAt(wave, now, colors, layout, { complete = true, after = wave?.started } = {}) {
  if (!wave || now < wave.started) return {};
  const { direction, motion, speed } = wave;
  const distance = (now - wave.started) * speed;
  const trailStart = (after - wave.started) * speed;
  const at = (index) => motion.tracks[index].at(distance, layout).day;
  const drawRibbon = (index, options) => {
    const track = motion.tracks[index];
    return ribbon((value) => track.at(value, layout), distance,
      { ...options, tail: track.length * options.tail }, complete, trailStart);
  };

  switch (wave.kind) {
    case 'daybreak-sweep':
      return { heads: [head(at(0), direction, colors.accent, 1, 5.7)] };
    case 'backlight-sweep':
      return { heads: [head(at(0), -direction, colors.secondary, 1, 2.9)] };
    case 'crossing-lights':
      return {
        heads: [
          head(at(0), direction, colors.secondary, .85, 3.2),
          head(at(1), -direction, colors.spark, .82, 3.2),
        ],
      };
    case 'over-under':
      return { ribbons: [drawRibbon(0, {
        color: colors.accent, tip: colors.spark, width: 3.1, tail: .25,
      })] };
    case 'sky-ribbon':
      return { ribbons: [drawRibbon(0, {
        color: colors.spark, tip: colors.accent, width: 3.6, tail: .22,
      })] };
    case 'split-pulse':
      return splitPulse(wave, motion, distance, colors, layout);
    case 'skipping-sparks':
      return { ribbons: [drawRibbon(0, {
        color: colors.secondary, tip: colors.spark, width: 2, tail: .16, beads: true,
      })] };
    case 'twin-ribbons':
      return {
        ribbons: [
          drawRibbon(0, {
            color: colors.accent, tip: colors.accent, width: 2.6, tail: .25,
          }),
          drawRibbon(1, {
            color: colors.spark, tip: colors.secondary, width: 2.15, tail: .19,
          }),
        ],
      };
    case 'beacon-landing':
      return landBall(wave, motion, distance, colors.spark, layout, complete, trailStart);
    default:
      return {};
  }
}

export function createRipple(index, started, { spacing, width }, audioProgressAt) {
  const distance = rippleReach * spacing;
  const speed = glowSpeedForWidth(width);
  return {
    index,
    distance,
    audioBound: Boolean(audioProgressAt),
    progressAt: audioProgressAt ?? ((now) => (now - started) * speed / distance),
  };
}

function rippleHeads(ripple, colors, layout) {
  const { index, progress, audioBound, distance } = ripple;
  const directions = [-1, 1];
  if (!audioBound) {
    ripple.tracks ??= directions.map((direction) => graphTrack(
      followGraph(index, index + direction * rippleReach), layout,
    ));
  }
  const spread = rippleReach * (1 - (1 - progress) ** 2);
  const traveled = distance * progress;
  return directions.map((direction, side) => {
    const track = ripple.tracks?.[side];
    // Each side fades by the time it reaches its own endpoint, even on an uneven graph.
    const fraction = track ? Math.min(1, traveled / Math.min(distance, track.length)) : progress;
    const day = track ? track.at(traveled, layout).day : index + direction * spread;
    return head(day, direction, direction === 1 ? colors.accent : colors.spark, 1.65 * (1 - fraction) ** 2, 1.5);
  });
}

export function traceCurve(points) {
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

function paintRipple(context, { index, progress, audioBound, distance }, color, points) {
  const origin = points[index - points[0].index];
  if (!origin) return;
  const remaining = 1 - progress;
  const radius = audioBound ? 35 * (1 - remaining ** 4) : Math.min(35, distance * progress);
  circle(context, origin.x, origin.y, 6 + radius);
  context.strokeStyle = tint(color, .92 * remaining ** 3);
  context.lineWidth = 1.5 + remaining;
  context.stroke();
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

function graphContacts({ heads, ribbons, ball }) {
  return heads ?? (ball ? [ball] : ribbonTips(ribbons));
}

function nodeLightAt(wave, now, colors, layout) {
  const { kind, started, departed = Infinity, motion, visit, speed } = wave;
  return ({ index, y }) => {
    let light;
    for (const { track, offset = 0, contact = 0 } of motion.nodeTracks) {
      const crossing = track.distanceAtDay(index);
      if (crossing === undefined) continue;
      const elapsed = (offset + crossing) / speed;
      const followsLead = contact === 0 || !companionTracks[kind];
      const paused = followsLead && visit && elapsed >= visit.begin ? visit.delay : 0;
      const arrived = started + elapsed + paused;
      const age = now - arrived;
      if (age < -1e-6 || age >= glowFade || arrived >= departed || (light && arrived <= light.arrived)) continue;
      const effects = traversalAt(wave, started + elapsed, colors, layout, { complete: false });
      const tip = graphContacts(effects)[contact];
      // A tip passing over the same day can still be above or below the node.
      if (!tip || Math.abs(tip.day - index) > 1e-6 || Math.abs((tip.y ?? y) - y) > .5) continue;
      light = { arrived, color: tip.color, charge: 1 - smooth(Math.max(0, age) / glowFade) };
    }
    return light;
  };
}

function inkOnGraph(wave, now, colors, layout) {
  if (!wave?.ink) return null;
  const marks = new Map();
  const visitStart = wave.started + (wave.visit?.begin ?? 0);
  const leadSince = wave.visit?.delay > 0 && now >= visitStart ? visitStart + wave.visit.delay : wave.started;
  const earliest = companionTracks[wave.kind] ? wave.started : leadSince;
  for (let age = 0; age < glowFade && now - age >= earliest; age += 20) {
    const time = now - age;
    if (wave.departed !== undefined && time >= wave.departed) continue;
    const phase = waveFrameAt(wave, time);
    const effects = traversalOnGraph(wave, phase, colors, layout, {
      complete: false, includeLead: time >= leadSince,
    });
    for (const { day, y, strength } of graphContacts(effects)) {
      const distance = y === undefined ? 0 : (y - layout.yAt(day)) / 18;
      const brightness = Math.exp(-(distance ** 2)) * strength * (1 - age / glowFade) ** 1.35;
      if (!(brightness > .025)) continue;
      const bucket = Math.floor(day);
      let nearby = marks.get(bucket);
      if (!nearby) {
        nearby = [];
        marks.set(bucket, nearby);
      }
      nearby.push({ day, brightness });
    }
  }
  if (!marks.size) return null;
  return {
    color: colors.accent,
    at(day) {
      let strength = 0;
      const last = Math.floor(day + inkReach);
      for (let bucket = Math.floor(day - inkReach); bucket <= last; bucket++) {
        const nearby = marks.get(bucket);
        if (!nearby) continue;
        for (const mark of nearby) {
          const distance = Math.abs(mark.day - day);
          if (distance < inkReach) strength = Math.max(strength, mark.brightness * smooth(1 - distance / inkReach));
        }
      }
      return strength;
    },
  };
}

function paintInk(context, path, ink, firstDay, width, spacing) {
  if (!ink) return;
  const steps = Math.ceil(width / spacing * 9);
  const strengths = Array.from({ length: steps + 1 }, (_, step) => ink.at(firstDay + step / steps * width / spacing));
  if (!strengths.some(Boolean)) return;
  const gradient = context.createLinearGradient(0, 0, width, 0);
  for (let step = 0; step <= steps; step++) {
    const strength = strengths[step];
    // Keep the transparent stop on each edge of the fade.
    if (strength || strengths[step - 1] || strengths[step + 1]) {
      gradient.addColorStop(step / steps, tint(ink.color, Math.min(1, strength * 1.15)));
    }
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
  const visibleBloom = bloom > 0 ? Math.min(bloomRadius, y - height * effectTop, height * effectBottom - y) : 0;
  const extent = Math.max(glow, visibleBloom);
  if (x < -extent || x > width + extent || y < -extent || y > height + extent) return;
  if (visibleBloom > 0) halo(context, x, y, visibleBloom, color, bloom * .92);
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

function drawNodeGlow(context, x, y, size, power, color, charge) {
  if (charge < .015) return;
  halo(context, x, y, 24 + power * 29, color, charge * (.3 + .42 * power));
  circle(context, x, y, size + 1 + charge * (2 + power * 6));
  context.strokeStyle = tint(color, charge * (.28 + .31 * power));
  context.lineWidth = 1 + power;
  context.stroke();
}

function drawPoints(context, points, ripples, colors, today, selected, width, nodeLight, dye) {
  for (const point of points) {
    if (point.x < -48 || point.x > width + 48) continue;
    const { x, y, index, power, count } = point;
    const current = index === today;
    const chosen = index === selected;
    const future = index > today;
    const light = nodeLight?.(point);
    const dyed = dye && light ? light.charge : 0;
    const size = 3 + (current || chosen ? 1.65 : 0) + (count ? .85 : 0) + power * 3.1 + dyed * .7;
    const base = power > .58 ? colors.spark : count || current || chosen ? colors.accent : colors.secondary;
    const color = dyed ? mixColor(base, dye, Math.min(1, dyed * 1.45)) : base;

    if (current || count || chosen) {
      halo(context, x, y, 13 + power * 16, color, .17 + .19 * power);
    }
    if (dyed > .025) halo(context, x, y, 19 + power * 12, dye, dyed * .48);
    if (light) drawNodeGlow(context, x, y, size, power, light.color, light.charge);
    for (const ripple of ripples) {
      const distance = index - ripple.day;
      const charge = Math.exp(-(distance ** 2) / (.53 + power * .75)) * ripple.strength;
      drawNodeGlow(context, x, y, size, power, ripple.color, charge);
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

function visitOrigin(visit, lead, worldToX, yAt) {
  return { x: visit.stage.left + worldToX(lead.day), y: visit.stage.top + (lead.y ?? yAt(lead.day)) };
}

function planVisit(wave, visit, width, colors, worldToX, layout) {
  const { length, visitFrom = length * .15, visitTo = length * .85 } = wave.motion;
  let closest = Infinity;
  let moment;
  let selectedLead;
  for (let index = 0; index <= 48; index++) {
    const elapsed = mix(visitFrom, visitTo, index / 48) / wave.speed;
    const signal = traversalAt(wave, wave.started + elapsed, colors, layout, { complete: false });
    const lead = leadOf(wave, signal);
    if (!lead) continue;
    const { x, y } = visitOrigin(visit, lead, worldToX, layout.yAt);
    if (x < visit.stage.left + 12 || x > visit.stage.left + width - 12 || y < 6 || y > innerHeight - 6) continue;
    const sideX = lead.direction > 0 ? visit.panel.left : visit.panel.right;
    const distance = Math.abs(x - sideX) + Math.max(0, y - visit.panel.top) * .45;
    if (distance < closest) {
      closest = distance;
      moment = elapsed;
      selectedLead = lead;
    }
  }
  if (moment === undefined) return null;
  const origin = visitOrigin(visit, selectedLead, worldToX, layout.yAt);
  const { route } = drawerPath(visit.panel, selectedLead.direction, origin);
  const timing = measurePath(route, 720);
  return { begin: moment, timing, delay: timing.length / wave.speed };
}

function waveFrameAt(wave, now) {
  const visit = wave?.visit;
  if (!visit) return { time: now, uninterruptedTime: now, loop: null, rejoin: null };
  const elapsed = now - wave.started;
  const intoVisit = elapsed - visit.begin;
  const detouring = intoVisit >= 0 && intoVisit < visit.delay;
  const spentVisiting = clamp(intoVisit, 0, visit.delay);
  const rejoin = visit.delay > 0 && intoVisit >= visit.delay ? {
    time: wave.started + visit.begin,
    age: intoVisit - visit.delay,
  } : null;
  return {
    time: now - spentVisiting,
    uninterruptedTime: now,
    loop: detouring ? intoVisit / visit.delay : null,
    rejoin,
  };
}

function rejoinedHeads(heads, startingHeads) {
  return heads.map((head) => {
    const start = startingHeads.find(({ direction }) => direction === head.direction);
    const tail = start ? clamp((head.day - start.day) * head.direction, 0, head.tail) : head.tail;
    return { ...head, tail };
  });
}

function traversalOnGraph(wave, phase, colors, layout, { complete = true, includeLead = true, startingHeads } = {}) {
  const leadOnGraph = includeLead && phase.loop === null;
  const effects = leadOnGraph
    ? traversalAt(wave, phase.time, colors, layout, { complete, after: phase.rejoin?.time })
    : {};
  if (startingHeads && effects.heads) effects.heads = rejoinedHeads(effects.heads, startingHeads);

  const track = companionTracks[wave?.kind];
  if (track && (!leadOnGraph || phase.time !== phase.uninterruptedTime)) {
    const companion = traversalAt(wave, phase.uninterruptedTime, colors, layout, { complete })[track]?.[1];
    effects[track] = [effects[track]?.[0], companion].filter(Boolean);
  }
  return effects;
}

function traversalInView({ heads = [], ribbons = [], ball }, worldToX, width) {
  const overlaps = (a, b = a) => {
    const first = worldToX(a);
    const last = worldToX(b);
    return Math.max(first, last) >= -64 && Math.min(first, last) <= width + 64;
  };
  return (ball && overlaps(ball.day))
    || heads.some(({ day, direction, tail }) => overlaps(day, day - direction * tail))
    || ribbons.some(({ points }) => overlaps(points[0].day, points.at(-1).day));
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
const goesAround = .23;
const rejoins = .76;

function drawerPath(panel, direction, origin) {
  const rim = sampleRim(panel, direction);
  const entry = rim(0);
  const route = (position) => {
    if (position < goesAround) {
      return cubic(origin, { x: origin.x + direction * 54, y: origin.y },
        { x: entry.x, y: entry.y + 44 }, entry, position / goesAround);
    }
    if (position < rejoins) return rim((position - goesAround) / (rejoins - goesAround));
    return cubic(entry, { x: entry.x, y: entry.y - 44 },
      { x: origin.x - direction * 54, y: origin.y }, origin, (position - rejoins) / (1 - rejoins));
  };
  return { rim, entry, route };
}

function paintVisit(canvas, visit, lead, progress, timing, worldToX, yAt, ratio) {
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
  const { rim, entry, route } = drawerPath(visit.panel, direction, visitOrigin(visit, lead, worldToX, yAt));
  const positionAt = (fraction) => timing.positionAt(fraction * timing.length);

  const position = positionAt(progress);
  const arc = clamp((position - goesAround) / (rejoins - goesAround), 0, 1);
  if (arc > 0 && progress < 1) {
    const d = new Path2D();
    d.moveTo(entry.x, entry.y);
    const steps = Math.max(1, Math.ceil(arc * 144));
    for (let index = 1; index <= steps; index++) {
      const point = rim(arc * index / steps);
      d.lineTo(point.x, point.y);
    }
    const fade = 1 - smooth(clamp((position - rejoins) / (1 - rejoins), 0, 1));
    stroke(context, d, tint(color, .13 * fade), 13);
    stroke(context, d, tint(color, .58 * fade), 1.65);
  }
  // The last part of the loop stays attached to the graph as the glow moves on.
  const end = Math.min(1, progress);
  const tail = Math.max(0, progress - loopTrailLength);
  const trail = Array.from({ length: 30 }, (_, index) => route(positionAt(mix(tail, end, index / 29))));
  const opacity = 1 - smooth(clamp((progress - 1) / loopTrailLength, 0, 1));
  paintTrail(context, trail, { color, tip: color, width: 2.9, quietTip: progress >= 1, opacity }, width, height);
}

export function paintGraph(canvas, frame) {
  const { width, height, ratio, points, pointAt, colors, today, selected, baseline, spacing, wave, ripples = [], now, visit, drawerGlow } = frame;
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
  const layout = { yAt, height, spacing };
  if (wave && !wave.motion) {
    // Keep the launch speed alongside the measured path if the viewport resizes mid-wave.
    wave.speed = glowSpeedForWidth(width);
    wave.motion = prepareWave(wave, layout);
  }
  const dye = wave?.ink && colors[wave.ink];
  const waveColors = dye ? { accent: dye, secondary: dye, spark: dye } : colors;
  if (wave?.panel && visit && wave.visit === undefined) {
    wave.visit = planVisit(wave, visit, width, waveColors, worldToX, layout);
  } else if (wave?.visit && !visit) {
    wave.visit.delay = clamp(now - wave.started - wave.visit.begin, 0, wave.visit.delay);
  }
  const phase = waveFrameAt(wave, now);
  const atRejoin = phase.rejoin && traversalAt(wave, phase.rejoin.time, waveColors, layout, { complete: false });
  const loopProgress = phase.loop ?? (phase.rejoin ? 1 + phase.rejoin.age / wave.visit.delay : null);
  const lead = visit && loopProgress !== null && loopProgress < 1 + loopTrailLength && leadOf(wave,
    atRejoin ?? traversalAt(wave, phase.time, waveColors, layout, { complete: false }));
  if (lead) paintVisit(drawerGlow, visit, lead, loopProgress, wave.visit.timing, worldToX, yAt, ratio);
  else drawerGlow.hidden = true;
  let onGraph = wave?.departed === undefined
    ? traversalOnGraph(wave, phase, waveColors, layout, { startingHeads: atRejoin?.heads })
    : {};
  if (wave && (phase.time - wave.started) * wave.speed >= wave.motion.length && wave.departed === undefined) {
    if (!traversalInView(onGraph, worldToX, width)) {
      wave.departed = now;
      wave.ends = now + glowFade;
      onGraph = {};
    }
  }
  const ink = inkOnGraph(wave, now, waveColors, layout);
  const nodeLight = wave && nodeLightAt(wave, now, waveColors, layout);
  const splitRipple = onGraph.ripple;
  const rippleLights = ripples.flatMap((ripple) => rippleHeads(ripple, colors, layout));
  if (splitRipple) rippleLights.push(...rippleHeads(splitRipple, waveColors, layout));
  const heads = [...(onGraph.heads ?? []), ...rippleLights];
  const ribbons = onGraph.ribbons ?? [];
  const path = frame.curve ?? traceCurve(points);

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
  drawPoints(context, points, rippleLights, colors, today, selected, width, nodeLight, dye);
  for (const head of heads) {
    if (head.strength > .025) waveTip(context, yAt, head, worldToX, width);
  }
  if (onGraph.ball) paintBall(context, onGraph.ball, worldToX, width, height);

  for (const ripple of ripples) paintRipple(context, ripple, colors.spark, points);
  if (splitRipple) paintRipple(context, splitRipple, waveColors.spark, points);
}
