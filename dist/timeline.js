import { dateForIndex, fullLabel, indexForKey, keyForIndex, shortLabel, todayIndex } from './timeline-data.js';
import { blendPalettes, createRipple, driftPalette, paintGraph, paletteFor, randomWave, traceCurve } from './graph.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const emptyScore = { height: 0, power: 0, count: 0 };
const heightAnimationSeconds = .44;

export function createTimeline({ stage, canvas, days, yearLabels, backToday, drawer, dialog, drawerGlow, onSelect }) {
  const surface = stage.parentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const nodes = new Map();
  const years = new Map();
  let today = todayIndex();
  let camera = today;
  let target = today;
  let todaySwipe;
  let selected = null;
  let score = () => emptyScore;
  let heights = new Map();
  let scoreElapsedAt;
  let pendingLogEffects = [];
  let wave;
  let ripples = [];
  let geometry;
  let paintedEffects = false;
  let animation = 0;
  let previousFrame = 0;
  let colorTimer;
  let traversalTimer;
  let ambientPausedAt = performance.now();
  let ambientPauseDuration = 0;
  let layoutDirty = true;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let spacing = 52;
  let gesture;
  let blockClick = false;
  let wheelTimer;
  let baseTheme;
  let fromTheme;
  let themeBegan = 0;
  let colors = {};

  function schedule() {
    clearTimeout(colorTimer);
    if (!animation) animation = requestAnimationFrame(render);
  }

  function scheduleLayout() {
    layoutDirty = true;
    schedule();
  }

  function heightProgress(now) {
    if (motion.matches || !heights.size) return 1;
    return 1 - (1 - clamp(scoreElapsedAt(now) / heightAnimationSeconds, 0, 1)) ** 3;
  }

  function updateScores(nextScore, now, elapsedAt = (frame) => (frame - now) / 1000) {
    const progress = heightProgress(now);
    const oldHeights = heights;
    heights = new Map();
    if (!motion.matches) {
      for (const index of nodes.keys()) {
        const old = score(index, today).height;
        const start = oldHeights.get(index) ?? old;
        if (nextScore(index, today).height !== old || oldHeights.has(index)) {
          heights.set(index, start + (old - start) * progress);
        }
      }
    }
    scoreElapsedAt = elapsedAt;
    score = nextScore;
    geometry = undefined;
    layoutDirty = true;
  }

  function startLogEffects(now) {
    pendingLogEffects = pendingLogEffects.filter(({ index, playback, getScores }) => {
      if (!motion.matches && playback?.elapsedAt(now) < 0) return true;
      const nextScore = getScores();
      if (nextScore) updateScores(nextScore, now, playback?.elapsedAt);
      if (!motion.matches) {
        const progressAt = playback && ((frame) => playback.elapsedAt(frame) / playback.duration);
        ripples.push(createRipple(index, now, spacing, progressAt));
      }
      return false;
    });
  }

  function resize() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    ratio = Math.min(devicePixelRatio, 2);
    spacing = Math.max(width < 680 ? 51 : 61, width / 21);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    geometry = undefined;
    scheduleLayout();
  }

  function pointFor(index, baseline, progress) {
    const value = score(index, today);
    const before = heights.get(index) ?? value.height;
    const lift = before + (value.height - before) * progress;
    return {
      ...value, index,
      x: width / 2 + (index - camera) * spacing,
      y: baseline - lift * height * .49,
    };
  }

  function createGeometry(progress) {
    const first = Math.floor(camera - width / (2 * spacing)) - 2;
    const last = Math.ceil(camera + width / (2 * spacing)) + 2;
    const baseline = height * .56;
    const pointCache = new Map();
    const pointAt = (index) => {
      if (!pointCache.has(index)) pointCache.set(index, pointFor(index, baseline, progress));
      return pointCache.get(index);
    };
    const points = [];
    for (let index = first; index <= last; index++) points.push(pointAt(index));
    return { camera, baseline, points, pointAt, curve: traceCurve(points) };
  }

  function buttonFor(point) {
    const { index } = point;
    const button = document.createElement('button');
    const label = document.createElement('span');
    const date = dateForIndex(index);
    button.type = 'button';
    button.className = 'day';
    button.dataset.date = keyForIndex(index);
    label.className = 'day-label';
    label.textContent = shortLabel(date);
    button.append(label);
    button.addEventListener('click', () => select(index));
    days.append(button);
    nodes.set(index, { button, date });
    return nodes.get(index);
  }

  function updateDays(points) {
    const visible = new Set();
    const focusedDay = Math.round(todaySwipe ? camera : target);
    for (const point of points) {
      const { index, x, y, power } = point;
      if (x < 0 || x > width) continue;
      visible.add(index);
      const { button, date } = nodes.get(index) ?? buttonFor(point);
      button.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      button.style.setProperty('--power', power.toFixed(3));
      button.tabIndex = index === focusedDay ? 0 : -1;
      button.setAttribute('aria-label', fullLabel(date) + (index > today ? ', upcoming' : ''));
      button.setAttribute('aria-pressed', String(index === selected));
      if (index === today) button.setAttribute('aria-current', 'date');
      else button.removeAttribute('aria-current');
      button.toggleAttribute('data-future', index > today);
      button.toggleAttribute('data-work', point.count > 0);
    }

    for (const [index, { button }] of nodes) {
      if (visible.has(index)) continue;
      if (document.activeElement === button) nodes.get(Math.round(camera))?.button.focus({ preventScroll: true });
      button.remove();
      nodes.delete(index);
    }
  }

  function updateYears(points) {
    const nearby = new Set();
    for (const { index, x } of points) {
      if (x < -spacing || x > width + spacing) continue;
      const date = dateForIndex(index);
      const isYearBoundary = (date.getUTCMonth() === 0 && date.getUTCDate() === 1)
        || (date.getUTCMonth() === 11 && date.getUTCDate() === 31);
      if (!isYearBoundary) continue;
      nearby.add(index);
      let year = years.get(index);
      if (!year) {
        year = document.createElement('span');
        year.className = 'year';
        year.textContent = date.getUTCFullYear();
        yearLabels.append(year);
        years.set(index, year);
      }
      year.style.left = `${clamp(x, 23, width - 23)}px`;
      year.style.opacity = clamp(Math.min(x, width - x) / (spacing * .65), 0, 1);
    }
    for (const [index, year] of years) {
      if (nearby.has(index)) continue;
      year.remove();
      years.delete(index);
    }
  }

  function updateColors(theme, now) {
    const interpolated = () => {
      const progress = clamp((now - themeBegan) / 720, 0, 1);
      return blendPalettes(fromTheme, baseTheme, progress * progress * (3 - 2 * progress));
    };
    if (!baseTheme || motion.matches) {
      baseTheme = fromTheme = theme;
      themeBegan = now;
    } else if (baseTheme !== theme) {
      fromTheme = interpolated();
      baseTheme = theme;
      themeBegan = now;
    }
    const next = motion.matches ? theme : driftPalette(interpolated(), now);
    let changed = false;
    for (const [name, value] of Object.entries(next)) {
      if (colors[name] === value) continue;
      document.documentElement.style.setProperty('--' + name, value);
      changed = true;
    }
    colors = next;
    return changed;
  }

  function ambientTime(now) {
    return (ambientPausedAt ?? now) - ambientPauseDuration;
  }

  function render(now) {
    animation = 0;
    if (!width || !height) return;
    const elapsed = Math.min(45, now - previousFrame);
    const lastCamera = camera;
    previousFrame = now;
    let arrivedToday = false;
    if (todaySwipe) {
      const progress = motion.matches ? 1 : clamp((now - todaySwipe.startedAt) / todaySwipe.duration, 0, 1);
      if (progress === 1) {
        camera = target;
        todaySwipe = undefined;
        arrivedToday = true;
      } else {
        const eased = progress * progress * (3 - 2 * progress);
        camera = todaySwipe.from + (target - todaySwipe.from) * eased;
      }
    } else if (motion.matches || Math.abs(target - camera) < .002) camera = target;
    else camera += (target - camera) * (1 - Math.exp(-elapsed / (gesture?.dragging ? 27 : 82)));

    if (pendingLogEffects.length) startLogEffects(now);
    const progress = heightProgress(now);
    const geometryChanged = geometry?.camera !== camera || heights.size > 0;
    if (geometryChanged) geometry = createGeometry(progress);
    const { points, pointAt, baseline, curve } = geometry;
    const selectedIsVisible = selected !== null && Math.abs(selected - camera) * spacing < width / 2;
    const ambientNow = ambientTime(now);
    const paletteChanged = updateColors(paletteFor(score(selectedIsVisible ? selected : Math.round(camera), today)), ambientNow);
    if (wave && ambientNow >= wave.ends) wave = undefined;
    ripples = ripples.filter((ripple) => {
      ripple.progress = Math.max(0, ripple.progressAt(now));
      return ripple.progress < 1;
    });
    const effects = Boolean(wave || ripples.length);
    if (geometryChanged || layoutDirty || paletteChanged || effects || paintedEffects) {
      const panel = wave?.panel?.getBoundingClientRect();
      const visit = panel?.height ? { panel, stage: stage.getBoundingClientRect() } : null;
      paintGraph(canvas, {
        width, height, ratio, points, pointAt, curve, colors, today, selected, baseline, spacing,
        wave, ripples, now: ambientNow, visit, drawerGlow,
      });
      paintedEffects = effects;
    }
    if (layoutDirty || camera !== lastCamera || heights.size || arrivedToday) {
      updateDays(points);
      updateYears(points);
      if (arrivedToday && document.activeElement === backToday) {
        nodes.get(today)?.button.focus({ preventScroll: true });
      }
      backToday.hidden = !todaySwipe && Math.abs(target - today) < .55;
      layoutDirty = false;
    }
    const ambientRunning = ambientPausedAt === null;
    if (todaySwipe || camera !== target || (ambientRunning && wave) || pendingLogEffects.length
      || ripples.length || (heights.size && progress < 1)) schedule();
    else if (!motion.matches && ambientRunning) colorTimer = setTimeout(schedule, 40);
    if (progress === 1) heights.clear();
  }

  function select(index) {
    selected = selected === index ? null : index;
    onSelect(selected);
    scheduleLayout();
  }

  function closeSelected() {
    const index = selected;
    selected = null;
    onSelect(selected);
    nodes.get(index)?.button.focus({ preventScroll: true });
    scheduleLayout();
  }

  function moveTo(index, focus = false) {
    todaySwipe = undefined;
    target = index;
    layoutDirty = true;
    if (focus && !nodes.has(index)) {
      camera = target;
      cancelAnimationFrame(animation);
      render(performance.now());
    }
    if (focus) nodes.get(index)?.button.focus({ preventScroll: true });
    schedule();
  }

  stage.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const focused = event.target.closest('.day')?.dataset.date;
    const index = focused ? indexForKey(focused) : Math.round(target);
    moveTo(event.key === 'Home' ? today : index + (event.key === 'ArrowLeft' ? -1 : 1), true);
  });

  function onPanel(event) {
    const panel = event.target.closest('#day-drawer, dialog');
    if (!panel) return false;
    if (panel.matches(':modal')) return true;
    const { left, top, right, bottom } = panel.getBoundingClientRect();
    return event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;
  }

  surface.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    blockClick = false;
    if (onPanel(event)) return;
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastTime: event.timeStamp, start: camera, velocity: 0,
    };
  });

  surface.addEventListener('pointermove', (event) => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    if (!gesture.dragging) {
      if (Math.abs(dx) < 7 || Math.abs(dx) <= Math.abs(event.clientY - gesture.y)) return;
      surface.setPointerCapture(event.pointerId);
      gesture.dragging = true;
      blockClick = true;
      surface.classList.add('dragging');
    }
    const elapsed = Math.max(10, event.timeStamp - gesture.lastTime);
    gesture.velocity = .35 * gesture.velocity + .65 * (event.clientX - gesture.lastX) / elapsed;
    gesture.lastTime = event.timeStamp;
    gesture.lastX = event.clientX;
    moveTo(gesture.start - dx / spacing);
  });

  function finishGesture(event) {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.dragging) {
      const velocity = event.type === 'pointerup' && event.timeStamp - gesture.lastTime < 95 ? gesture.velocity : 0;
      const coast = motion.matches ? 0 : clamp(-velocity * 120 / spacing, -4, 4);
      moveTo(Math.round(target + coast));
    }
    gesture = undefined;
    surface.classList.remove('dragging');
  }

  surface.addEventListener('pointerup', finishGesture);
  surface.addEventListener('pointercancel', finishGesture);
  surface.addEventListener('lostpointercapture', (event) => {
    if (event.target === surface) finishGesture(event);
  });
  surface.addEventListener('pointerleave', () => { if (!gesture?.dragging) gesture = undefined; });
  surface.addEventListener('click', (event) => {
    if (blockClick && event.detail > 0 && !onPanel(event)) event.stopImmediatePropagation();
  }, true);

  surface.addEventListener('wheel', (event) => {
    if (onPanel(event)) return;
    const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    if (!delta || (!event.shiftKey && Math.abs(delta) < Math.abs(event.deltaY))) return;
    event.preventDefault();
    const units = [1, 16, width][event.deltaMode] ?? 1;
    moveTo((todaySwipe ? camera : target) + delta * units / spacing);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => moveTo(Math.round(target)), 140);
  }, { passive: false });

  function followToday() {
    const next = todayIndex();
    if (next !== today) {
      if (todaySwipe) target = next;
      else if (Math.round(target) === today) moveTo(next);
      today = next;
      geometry = undefined;
      onSelect(selected);
      scheduleLayout();
    }
  }

  function traverse() {
    followToday();
    if (motion.matches || ambientPausedAt !== null || !width || (wave && wave.departed === undefined)) return;
    wave = randomWave({
      center: camera, visibleDays: width / spacing, today, now: ambientTime(performance.now()),
      countAt: (day) => score(day, today).count,
    });
    if (!drawer.hidden && Math.random() < .4) {
      wave.panel = dialog.open && dialog.classList.contains('log-dialog') ? dialog : drawer;
    }
    schedule();
  }

  function updateAmbientFocus() {
    if (document.hidden || !document.hasFocus()) {
      if (ambientPausedAt !== null) return;
      ambientPausedAt = performance.now();
      clearTimeout(colorTimer);
      clearInterval(traversalTimer);
      return;
    }
    if (ambientPausedAt === null) return;
    ambientPauseDuration += performance.now() - ambientPausedAt;
    ambientPausedAt = null;
    traversalTimer = setInterval(traverse, 5000);
    followToday();
    schedule();
  }

  backToday.addEventListener('click', () => {
    followToday();
    if (todaySwipe) return;
    clearTimeout(wheelTimer);
    todaySwipe = {
      from: camera,
      startedAt: performance.now(),
      duration: Math.min(1900, 240 + 12 * Math.abs(today - camera)),
    };
    target = today;
    scheduleLayout();
  });
  motion.addEventListener('change', () => {
    if (motion.matches) {
      wave = undefined;
      ripples = [];
    }
    schedule();
  });
  window.addEventListener('blur', updateAmbientFocus);
  window.addEventListener('focus', updateAmbientFocus);
  document.addEventListener('visibilitychange', updateAmbientFocus);
  new ResizeObserver(resize).observe(stage);
  resize();
  updateAmbientFocus();

  return {
    closeSelected,
    pulse(index) {
      if (motion.matches) return;
      ripples.push(createRipple(index, performance.now(), spacing));
      schedule();
    },
    showSavedLog(index, playback, getScores) {
      pendingLogEffects.push({ index, playback, getScores });
      schedule();
    },
    setScores(nextScore) {
      updateScores(nextScore, performance.now());
      schedule();
    },
  };
}
