/**
 * Source-adapted React Bits StarBorder and ShinyText by David Haz.
 * Upstream: https://github.com/DavidHDev/react-bits/tree/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce
 * MIT + Commons Clause: see ../THIRD_PARTY_NOTICES.md.
 * Local adaptations: combined modules, enclosing-button pointer/focus events,
 * local mounting, and static rendering while hidden or reduced motion is requested.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './react-bits.css';

const THEMES = {
  dark: {
    surface: '#0c0c0f',
    text: '#fafafa',
    track: 'rgba(255, 255, 255, 0.1)',
    light: '#ffffff'
  },
  light: {
    surface: '#ffffff',
    text: '#18181b',
    track: 'rgba(24, 24, 27, 0.12)',
    light: '#18181b'
  }
};

const HOVERS = ['lap', 'brighten', 'reveal', 'none'];
const BLEED = 48;
const LAP = 0.9;
const TAU = Math.PI * 2;
const WHITE = [255, 255, 255];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = (value, total) => ((value % total) + total) % total;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (rgb, alpha) =>
  `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(alpha, 0, 1).toFixed(3)})`;

let colorContext = null;

const toRgb = color => {
  colorContext = colorContext ?? document.createElement('canvas').getContext('2d');
  if (!colorContext) return WHITE;
  colorContext.fillStyle = '#000000';
  colorContext.fillStyle = color;
  const value = String(colorContext.fillStyle);
  if (value.startsWith('#')) {
    const hex = parseInt(value.slice(1, 7), 16);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? WHITE;
  return [parts[0], parts[1], parts[2]];
};

const outline = (width, height, radius) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const arc = (Math.PI * r) / 2;
  const across = Math.max(0, width - 2 * r);
  const down = Math.max(0, height - 2 * r);
  const segments = [
    { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
    { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
    { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
    { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
    { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
    { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
    { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
    { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI }
  ];
  return {
    r,
    segments,
    total: Math.max(
      1,
      segments.reduce((sum, segment) => sum + segment.length, 0)
    )
  };
};

const pointAt = (shape, distance, point) => {
  let s = wrap(distance, shape.total);
  for (const segment of shape.segments) {
    if (segment.length > 0 && s <= segment.length) {
      if (segment.angle === null) {
        point.x = segment.x + segment.dx * s;
        point.y = segment.y + segment.dy * s;
        point.nx = segment.dy;
        point.ny = -segment.dx;
      } else {
        const angle = segment.angle + s / shape.r;
        point.nx = Math.cos(angle);
        point.ny = Math.sin(angle);
        point.x = segment.x + point.nx * shape.r;
        point.y = segment.y + point.ny * shape.r;
      }
      return point;
    }
    s -= segment.length;
  }
  return point;
};

const project = (shape, px, py) => {
  let best = Infinity;
  let found = 0;
  let offset = 0;
  shape.segments.forEach(segment => {
    if (segment.length > 0) {
      let s = 0;
      let x = 0;
      let y = 0;
      if (segment.angle === null) {
        s = clamp((px - segment.x) * segment.dx + (py - segment.y) * segment.dy, 0, segment.length);
        x = segment.x + segment.dx * s;
        y = segment.y + segment.dy * s;
      } else {
        let angle = wrap(Math.atan2(py - segment.y, px - segment.x) - segment.angle, TAU);
        if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
        s = angle * shape.r;
        x = segment.x + Math.cos(segment.angle + angle) * shape.r;
        y = segment.y + Math.sin(segment.angle + angle) * shape.r;
      }
      const distance = (px - x) ** 2 + (py - y) ** 2;
      if (distance < best) {
        best = distance;
        found = offset + s;
      }
    }
    offset += segment.length;
  });
  return found;
};

const StarBorder = ({
  as: Component = 'button',
  children,
  className = '',
  style,
  color,
  trailColor,
  duration = 4,
  thickness = 1,
  radius = 12,
  trailLength = 0.3,
  stars = 1,
  glow = 0.6,
  sparkle = false,
  direction = 'clockwise',
  hover = 'lap',
  clickPulse = true,
  theme = 'dark',
  backgroundColor,
  textColor,
  borderColor,
  ...rest
}) => {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const wakeRef = useRef(null);
  const palette = THEMES[theme] ?? THEMES.dark;
  const light = color ?? palette.light;
  const settings = {
    light: theme === 'light',
    color: light,
    trailColor: trailColor ?? light,
    duration: Math.max(0.3, duration),
    thickness: Math.max(0.5, thickness),
    radius: Math.max(0, radius),
    trailLength: clamp(trailLength, 0, 1),
    stars: clamp(Math.round(stars), 1, 6),
    glow: clamp(glow, 0, 1),
    sparkle,
    direction: direction === 'counterclockwise' ? -1 : 1,
    hover: HOVERS.includes(hover) ? hover : 'lap',
    clickPulse
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const root = rootRef.current;
    // The existing launch button owns input; the React child only paints its border.
    const eventSurface = root?.closest('#launch') ?? root;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return undefined;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const point = { x: 0, y: 0, nx: 0, ny: -1 };
    const state = {
      width: 0,
      height: 0,
      dpr: 1,
      phase: 0,
      velocity: 0,
      motion: 0,
      lap: -1,
      time: 0,
      reveal: 0,
      boost: 0,
      flash: 0,
      emit: 0,
      hovered: false,
      focused: false,
      pointerX: 0,
      pointerY: 0,
      visible: true
    };
    const pulses = [];
    const dust = [];
    const colors = { key: '', head: WHITE, tail: WHITE };
    let raf = 0;
    let last = performance.now();
    let alive = true;

    let resizePending = false;
    const applyMeasure = () => {
      state.width = root.offsetWidth;
      state.height = root.offsetHeight;
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round((state.width + BLEED * 2) * state.dpr));
      canvas.height = Math.max(1, Math.round((state.height + BLEED * 2) * state.dpr));
    };

    const measure = () => {
      resizePending = true;
      wake();
    };

    const local = event => {
      const rect = root.getBoundingClientRect();
      const scaleX = rect.width ? state.width / rect.width : 1;
      const scaleY = rect.height ? state.height / rect.height : 1;
      return [(event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY];
    };

    const shapeFor = s =>
      outline(
        Math.max(1, state.width - s.thickness),
        Math.max(1, state.height - s.thickness),
        s.radius - s.thickness / 2
      );

    const stroke = (x1, y1, x2, y2, width, style) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    const drawTrail = (s, shape, head, length, sign, intensity, tip = true) => {
      if (length < 0.5 || intensity <= 0) return;
      const steps = clamp(Math.ceil(length / 2), 2, 90);
      pointAt(shape, head, point);
      let px = point.x;
      let py = point.y;
      for (let i = 1; i <= steps; i++) {
        pointAt(shape, head - sign * length * (i / steps), point);
        const u = 1 - (i - 0.5) / steps;
        const fade = u * u * intensity;
        let tone = mix(colors.tail, colors.head, u);
        if (!s.light) tone = mix(tone, WHITE, u ** 6 * 0.65);
        ctx.lineCap = tip && i === 1 ? 'round' : 'butt';
        stroke(px, py, point.x, point.y, 2 + 6 * s.glow, rgba(tone, fade * (s.light ? 0.1 : 0.2) * s.glow));
        stroke(px, py, point.x, point.y, s.thickness, rgba(tone, fade));
        px = point.x;
        py = point.y;
      }
    };

    const drawHead = (s, x, y, intensity, twinkle) => {
      if (intensity <= 0) return;
      const tone = colors.head;
      const reach = (12 + 40 * s.glow) * (s.light ? 0.6 : 1);
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
      const strength = (s.light ? 0.08 : 0.4) * s.glow * intensity;
      bloom.addColorStop(0, rgba(tone, strength));
      bloom.addColorStop(0.2, rgba(tone, strength * 0.4));
      bloom.addColorStop(0.5, rgba(tone, strength * 0.1));
      bloom.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      if (!s.sparkle) return;

      const size = (1 + s.thickness * 0.6) * (s.light ? 0.85 : 1);
      const core = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      core.addColorStop(0, rgba(s.light ? tone : WHITE, intensity));
      core.addColorStop(s.light ? 0.3 : 0.4, rgba(s.light ? tone : mix(tone, WHITE, 0.5), intensity * 0.9));
      core.addColorStop(s.light ? 0.55 : 1, rgba(tone, s.light ? intensity * 0.12 : 0));
      core.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.2, 0, TAU);
      ctx.fill();

      const spike = (3 + 4 * s.glow + s.thickness * 1.5) * twinkle;
      const center = s.light ? tone : WHITE;
      const horizontal = ctx.createLinearGradient(x - spike, y, x + spike, y);
      horizontal.addColorStop(0, rgba(tone, 0));
      horizontal.addColorStop(0.5, rgba(center, intensity * 0.95));
      horizontal.addColorStop(1, rgba(tone, 0));
      stroke(x - spike, y, x + spike, y, s.light ? 0.75 : 1, horizontal);
      const vertical = ctx.createLinearGradient(x, y - spike, x, y + spike);
      vertical.addColorStop(0, rgba(tone, 0));
      vertical.addColorStop(0.5, rgba(center, intensity * 0.95));
      vertical.addColorStop(1, rgba(tone, 0));
      stroke(x, y - spike, x, y + spike, s.light ? 0.75 : 1, vertical);
    };

    const spawnDust = (x, y, nx, ny, speed) => {
      if (dust.length > 48) return;
      const push = 3 + Math.random() * 10;
      const drift = (Math.random() - 0.5) * 8;
      dust.push({
        x: x + nx * (Math.random() * 3 - 1),
        y: y + ny * (Math.random() * 3 - 1),
        vx: nx * push - ny * drift - speed * -ny * 0.04,
        vy: ny * push + nx * drift - speed * nx * 0.04,
        age: 0,
        life: 0.35 + Math.random() * 0.5,
        size: 0.45 + Math.random() * 0.7,
        seed: Math.random() * TAU
      });
    };

    const draw = (base, shape) => {
      const s = state.boost > 0.001 ? { ...base, glow: Math.min(1.5, base.glow + 0.4 * state.boost) } : base;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.width < 2 || state.height < 2) return;
      const offset = (BLEED + s.thickness / 2) * state.dpr;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, offset, offset);
      ctx.globalCompositeOperation = s.light ? 'source-over' : 'lighter';
      ctx.lineCap = 'butt';

      const total = shape.total;
      const spacing = total / s.stars;
      const speed = Math.abs(state.motion);
      const sign = state.motion >= 0 ? 1 : -1;
      const span = s.trailLength * s.duration;
      const length = Math.min(speed * span, spacing * 0.92, total * 0.6);
      const intensity = state.reveal * (1 + 0.4 * state.boost + 0.6 * state.flash);

      const ring = state.flash * (s.light ? 0.18 : 0.32) + state.boost * state.reveal * (s.light ? 0.07 : 0.12);
      if (ring > 0.005) {
        ctx.lineWidth = s.thickness + 2 * s.glow;
        ctx.strokeStyle = rgba(colors.head, ring);
        ctx.beginPath();
        ctx.roundRect(
          0,
          0,
          Math.max(1, state.width - s.thickness),
          Math.max(1, state.height - s.thickness),
          Math.max(0, shape.r)
        );
        ctx.stroke();
      }

      const still = clamp(1 - speed / Math.max(1, (total / s.duration) * 0.6), 0, 1) * Math.min(1, intensity);
      const rest = (10 + 14 * s.glow + s.thickness * 2) * still;
      for (let i = 0; i < s.stars; i++) {
        const head = state.phase + i * spacing;
        drawTrail(s, shape, head, length, sign, Math.min(1, intensity));
        if (still > 0.01) {
          drawTrail(s, shape, head, rest, 1, still, false);
          drawTrail(s, shape, head, rest, -1, still, false);
        }
      }

      pulses.forEach(pulse => {
        const progress = pulse.age / 0.65;
        const fade = (1 - progress) ** 2;
        const travel = (total / 2) * (1 - (1 - Math.min(1, pulse.age / 0.5)) ** 2);
        const tail = Math.min(travel, total * 0.16);
        [1, -1].forEach(way => {
          const front = pulse.origin + way * travel;
          drawTrail(s, shape, front, tail, way, fade);
          pointAt(shape, front, point);
          drawHead(s, point.x, point.y, fade * 0.8, 0.8);
        });
      });

      for (let i = 0; i < s.stars; i++) {
        pointAt(shape, state.phase + i * spacing, point);
        const twinkle = 0.82 + 0.18 * Math.sin(state.time * 6.1 + i * 2.3) * Math.sin(state.time * 2.7 + i);
        drawHead(s, point.x, point.y, Math.min(1.3, intensity), twinkle);
      }

      dust.forEach(mote => {
        const left = 1 - mote.age / mote.life;
        const shimmer = 0.45 + 0.55 * Math.sin(state.time * 20 + mote.seed);
        const alpha = left * shimmer * state.reveal * (s.light ? 0.35 : 0.9);
        if (alpha <= 0.01) return;
        ctx.fillStyle = rgba(s.light ? colors.head : mix(colors.tail, WHITE, 0.6), alpha);
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size * (0.6 + 0.4 * left), 0, TAU);
        ctx.fill();
      });
    };

    const frame = now => {
      raf = 0;
      if (resizePending) {
        resizePending = false;
        applyMeasure();
      }
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      state.time += dt;

      const key = `${s.color}|${s.trailColor}`;
      if (key !== colors.key) {
        colors.key = key;
        colors.head = toRgb(s.color);
        colors.tail = toRgb(s.trailColor);
      }

      const shape = shapeFor(s);
      const total = shape.total;
      const spacing = total / s.stars;
      const engaged = state.hovered || state.focused;
      const cruise = reduce ? 0 : (s.direction * total) / s.duration;

      const revealTarget = s.hover === 'reveal' && !engaged ? 0 : 1;
      state.reveal += (revealTarget - state.reveal) * (1 - Math.exp(-dt / (revealTarget > state.reveal ? 0.16 : 0.45)));
      const boostTarget = s.hover === 'brighten' && engaged ? 1 : 0;
      state.boost += (boostTarget - state.boost) * (1 - Math.exp(-dt / (boostTarget > state.boost ? 0.18 : 0.5)));
      state.flash *= Math.exp(-dt / 0.22);

      state.velocity += (cruise - state.velocity) * (1 - Math.exp(-dt / 0.45));
      let extra = 0;
      if (state.lap >= 0) {
        const before = ease(Math.min(1, state.lap / LAP));
        state.lap += dt;
        extra = (ease(Math.min(1, state.lap / LAP)) - before) * total * s.direction;
        if (state.lap >= LAP) state.lap = -1;
      }
      state.motion = state.velocity + extra / dt;
      state.phase = wrap(state.phase + state.velocity * dt + extra, total);

      const pace = Math.abs(state.motion) / Math.max(1, Math.abs(total / s.duration));
      if (s.sparkle && !reduce && state.reveal > 0.05) {
        state.emit += dt * (2 + 6 * Math.min(2, pace)) * s.stars;
        while (state.emit > 1) {
          state.emit -= 1;
          pointAt(shape, state.phase + Math.floor(Math.random() * s.stars) * spacing, point);
          spawnDust(point.x, point.y, point.nx, point.ny, state.motion);
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const mote = dust[i];
        mote.age += dt;
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.vx *= Math.exp(-dt * 2.2);
        mote.vy *= Math.exp(-dt * 2.2);
        if (mote.age >= mote.life) dust.splice(i, 1);
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].age += dt;
        if (pulses[i].age >= 0.65) pulses.splice(i, 1);
      }

      draw(s, shape);

      const settling =
        Math.abs(revealTarget - state.reveal) > 0.002 ||
        Math.abs(boostTarget - state.boost) > 0.002 ||
        state.flash > 0.01 ||
        pulses.length > 0 ||
        dust.length > 0;
      const moving = Math.abs(state.motion) > 0.05 || cruise !== 0 || state.lap >= 0;
      const showing = state.reveal > 0.002 || revealTarget > 0;
      if (state.visible && (settling || (moving && showing) || state.hovered)) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || !alive || !state.visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const onEnter = event => {
      const s = settingsRef.current;
      [state.pointerX, state.pointerY] = local(event);
      state.hovered = true;
      if (s.hover === 'reveal' && state.reveal < 0.15) {
        state.phase = project(shapeFor(s), state.pointerX - s.thickness / 2, state.pointerY - s.thickness / 2);
        state.velocity = 0;
      }
      if (s.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onLeave = () => {
      state.hovered = false;
      wake();
    };
    const pulse = origin => {
      if (!settingsRef.current.clickPulse) return;
      pulses.push({ origin, age: 0 });
      if (pulses.length > 4) pulses.shift();
      state.flash = 1;
      wake();
    };
    const onDown = event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const s = settingsRef.current;
      const [x, y] = local(event);
      pulse(project(shapeFor(s), x - s.thickness / 2, y - s.thickness / 2));
    };
    const onClick = event => {
      if (event.detail === 0) pulse(state.phase);
    };
    const onFocus = () => {
      state.focused = eventSurface.matches(':focus-visible');
      if (state.focused && settingsRef.current.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onBlur = () => {
      state.focused = false;
      wake();
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    const visibility = new IntersectionObserver(entries => {
      state.visible = entries.some(entry => entry.isIntersecting);
      if (state.visible) wake();
    });
    visibility.observe(root);
    eventSurface.addEventListener('pointerenter', onEnter);
    eventSurface.addEventListener('pointerleave', onLeave);
    eventSurface.addEventListener('pointerdown', onDown);
    eventSurface.addEventListener('click', onClick);
    eventSurface.addEventListener('focus', onFocus);
    eventSurface.addEventListener('blur', onBlur);
    measure();

    return () => {
      alive = false;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      visibility.disconnect();
      eventSurface.removeEventListener('pointerenter', onEnter);
      eventSurface.removeEventListener('pointerleave', onLeave);
      eventSurface.removeEventListener('pointerdown', onDown);
      eventSurface.removeEventListener('click', onClick);
      eventSurface.removeEventListener('focus', onFocus);
      eventSurface.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    wakeRef.current?.();
  });

  return (
    <Component
      ref={rootRef}
      className={`star-border${className ? ` ${className}` : ''}`}
      style={{
        '--star-border-radius': `${settings.radius}px`,
        '--star-border-thickness': `${settings.thickness}px`,
        '--star-border-surface': backgroundColor ?? palette.surface,
        '--star-border-text': textColor ?? palette.text,
        '--star-border-track': borderColor ?? palette.track,
        ...style
      }}
      {...(Component === 'button' && rest.type === undefined ? { type: 'button' } : null)}
      {...rest}
    >
      <canvas ref={canvasRef} className="star-border__light" aria-hidden="true" />
      {children}
    </Component>
  );
};


const EASINGS = {
  linear: t => t,
  smooth: t => 0.5 - Math.cos(Math.PI * t) / 2,
  snappy: t => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2)
};
const TRIGGERS = ['loop', 'hover', 'view'];
const FALLOFF = [0, 0.2, 0.4, 0.6, 0.8, 1];

const shinyClamp = (value, min, max) => Math.min(max, Math.max(min, value));

let paint = null;

const parseColor = value => {
  if (typeof document === 'undefined') return null;
  if (!paint) paint = document.createElement('canvas').getContext('2d');
  if (!paint) return null;
  paint.fillStyle = '#000000';
  paint.fillStyle = value;
  const resolved = String(paint.fillStyle);
  if (resolved.startsWith('#')) {
    return [1, 3, 5].map(i => parseInt(resolved.slice(i, i + 2), 16)).concat(1);
  }
  const parts = resolved.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts.length > 3 ? Number(parts[3]) : 1];
};

const blend = (from, to, amount) => {
  const channel = (a, b) =>
    Math.round(Math.pow(Math.pow(a / 255, 2.2) * (1 - amount) + Math.pow(b / 255, 2.2) * amount, 1 / 2.2) * 255);
  const alpha = from[3] * (1 - amount) + to[3] * amount;
  if (alpha <= 0) return 'rgba(0, 0, 0, 0)';
  const weigh = (a, b) => (a * from[3] * (1 - amount) + b * to[3] * amount) / alpha;
  const r = from[3] === to[3] ? channel(from[0], to[0]) : Math.round(weigh(from[0], to[0]));
  const g = from[3] === to[3] ? channel(from[1], to[1]) : Math.round(weigh(from[1], to[1]));
  const b = from[3] === to[3] ? channel(from[2], to[2]) : Math.round(weigh(from[2], to[2]));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
};

const ShinyText = ({
  text,
  children,
  color = '#b5b5b5',
  shineColor = '#ffffff',
  speed = 2,
  delay = 0,
  angle = 120,
  shineWidth = 40,
  softness = 0.8,
  bands = 1,
  glow = 0,
  direction = 'left',
  easing = 'smooth',
  trigger = 'loop',
  yoyo = false,
  followPointer = false,
  pauseOnHover = false,
  disabled = false,
  className = '',
  style
}) => {
  const rootRef = useRef(null);
  const glowRef = useRef(null);
  const settingsRef = useRef(null);
  const syncRef = useRef(null);
  const content = children ?? text;

  settingsRef.current = {
    color,
    shineColor,
    speed: Math.max(0.1, speed),
    delay: Math.max(0, delay),
    angle,
    shineWidth: shinyClamp(shineWidth, 2, 200),
    softness: shinyClamp(softness, 0, 1),
    bands: shinyClamp(Math.round(bands), 1, 3),
    glow: shinyClamp(glow, 0, 1),
    sign: direction === 'right' ? 1 : -1,
    ease: EASINGS[easing] ?? EASINGS.smooth,
    trigger: TRIGGERS.includes(trigger) ? trigger : 'loop',
    yoyo,
    followPointer,
    pauseOnHover,
    disabled
  };

  useEffect(() => {
    syncRef.current?.();
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = {
      pos: null,
      vel: 0,
      phase: 'idle',
      from: 0,
      to: 0,
      start: 0,
      duration: 1,
      resume: 0,
      flip: false,
      inside: false,
      target: 0,
      visible: true,
      seen: false,
      colors: ''
    };
    let base = null;
    let shine = null;
    let clear = null;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let alive = true;

    const extent = () => {
      const s = settingsRef.current;
      return s.shineWidth / 2 + (s.bands - 1) * s.shineWidth * 1.3 + 2;
    };
    const entry = () => (settingsRef.current.sign > 0 ? -extent() : 100 + extent());
    const exit = () => (settingsRef.current.sign > 0 ? 100 + extent() : -extent());
    const nearest = () => (state.target < 50 ? -extent() : 100 + extent());

    const gradient = (pos, fill) => {
      const s = settingsRef.current;
      const half = s.shineWidth / 2;
      const core = half * (1 - s.softness);
      const fade = half - core;
      const stops = [];
      for (let band = 0; band < s.bands; band++) {
        const center = pos - s.sign * band * s.shineWidth * 1.3;
        const strength = 1 - band * 0.28;
        for (const side of [-1, 1]) {
          for (const f of FALLOFF) {
            const at = center + side * (core + fade * (1 - f));
            const amount = f * f * (3 - 2 * f) * strength;
            stops.push([at, amount]);
          }
        }
      }
      stops.sort((a, b) => a[0] - b[0]);
      const list = stops.map(([at, amount]) => `${blend(fill, shine, amount)} ${at.toFixed(2)}%`);
      return `linear-gradient(${s.angle}deg, ${blend(fill, shine, 0)} 0%, ${list.join(', ')}, ${blend(fill, shine, 0)} 100%)`;
    };

    const draw = () => {
      const s = settingsRef.current;
      const key = `${s.color}|${s.shineColor}`;
      if (key !== state.colors) {
        state.colors = key;
        base = parseColor(s.color);
        shine = parseColor(s.shineColor);
        clear = shine ? [shine[0], shine[1], shine[2], 0] : null;
      }
      if (!base || !shine) {
        root.style.backgroundImage = `linear-gradient(${s.color}, ${s.color})`;
        return;
      }
      if (state.pos === null || s.disabled) {
        root.style.backgroundImage = `linear-gradient(${s.color}, ${s.color})`;
        if (glowRef.current) glowRef.current.style.backgroundImage = 'none';
        return;
      }
      root.style.backgroundImage = gradient(state.pos, base);
      if (glowRef.current) {
        glowRef.current.style.backgroundImage = gradient(state.pos, clear);
        glowRef.current.style.opacity = String(s.glow);
      }
    };

    const sweep = (from, to, now) => {
      const s = settingsRef.current;
      const span = Math.abs(exit() - entry()) || 1;
      state.phase = 'sweep';
      state.from = from;
      state.to = to;
      state.start = now;
      state.duration = s.speed * 1000 * Math.max(0.15, Math.abs(to - from) / span);
    };

    const wake = () => {
      if (raf || !alive) return;
      window.clearTimeout(timer);
      timer = 0;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const tick = now => {
      raf = 0;
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (s.disabled) {
        state.pos = null;
        state.phase = 'idle';
        draw();
        return;
      }
      const following = s.followPointer && state.inside;
      if (following) {
        if (state.pos === null) state.pos = nearest();
        const stiffness = 220;
        state.vel += ((state.target - state.pos) * stiffness - state.vel * 2 * Math.sqrt(stiffness)) * dt;
        state.pos += state.vel * dt;
        state.phase = 'follow';
        draw();
        raf = requestAnimationFrame(tick);
        return;
      }
      if (state.phase === 'follow') {
        state.vel = 0;
        sweep(state.pos ?? nearest(), nearest(), now);
      }
      if (state.phase === 'sweep') {
        if (s.pauseOnHover && state.inside) {
          state.start += dt * 1000;
          raf = requestAnimationFrame(tick);
          return;
        }
        const t = shinyClamp((now - state.start) / state.duration, 0, 1);
        state.pos = state.from + (state.to - state.from) * s.ease(t);
        draw();
        if (t < 1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        if (s.trigger !== 'loop' || reduce) {
          state.phase = 'idle';
          state.pos = null;
          draw();
          return;
        }
        state.phase = 'wait';
        state.resume = now + s.delay * 1000;
      }
      if (state.phase === 'wait') {
        if (!state.visible) return;
        if (now < state.resume) {
          window.clearTimeout(timer);
          timer = window.setTimeout(wake, state.resume - now);
          return;
        }
        if (s.yoyo) {
          state.flip = !state.flip;
          sweep(state.flip ? exit() : entry(), state.flip ? entry() : exit(), now);
        } else {
          sweep(entry(), exit(), now);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (state.phase === 'idle' && s.trigger === 'loop' && !reduce && state.visible) {
        state.flip = false;
        sweep(entry(), exit(), now);
        raf = requestAnimationFrame(tick);
      }
    };

    const locate = event => {
      const s = settingsRef.current;
      const rect = root.getBoundingClientRect();
      const radians = (s.angle * Math.PI) / 180;
      const dx = Math.sin(radians);
      const dy = -Math.cos(radians);
      const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy) || 1;
      const along =
        (event.clientX - rect.left - rect.width / 2) * dx + (event.clientY - rect.top - rect.height / 2) * dy;
      return 50 + (along / length) * 100;
    };

    const onEnter = event => {
      const s = settingsRef.current;
      state.inside = true;
      state.target = locate(event);
      if (s.disabled) return;
      if (s.followPointer) {
        if (state.pos === null) state.pos = nearest();
      } else if (s.trigger === 'hover' && state.phase === 'idle' && !reduce) {
        sweep(entry(), exit(), performance.now());
      }
      wake();
    };
    const onMove = event => {
      state.target = locate(event);
      if (settingsRef.current.followPointer) wake();
    };
    const onLeave = () => {
      state.inside = false;
      wake();
    };

    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(item => item.isIntersecting);
      state.visible = visible;
      const s = settingsRef.current;
      if (!visible) return;
      if (s.trigger === 'view' && !state.seen && !reduce && !s.disabled) {
        state.seen = true;
        sweep(entry(), exit(), performance.now());
      }
      wake();
    });
    observer.observe(root);

    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);

    syncRef.current = () => {
      const s = settingsRef.current;
      if (s.disabled) {
        state.pos = null;
        state.phase = 'idle';
      } else if (s.trigger !== 'loop' && state.phase === 'wait') {
        state.phase = 'idle';
        state.pos = null;
      }
      draw();
      wake();
    };
    draw();
    wake();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      syncRef.current = null;
    };
  }, []);

  return (
    <span
      ref={rootRef}
      className={`shiny-text${className ? ` ${className}` : ''}`}
      style={{ backgroundImage: `linear-gradient(${color}, ${color})`, ...style }}
    >
      {content}
      {glow > 0 ? (
        <span ref={glowRef} className="shiny-text__glow" aria-hidden="true">
          {content}
        </span>
      ) : null}
    </span>
  );
};


// Pause decorative work while the game is hidden, and respond to preference changes.
function useDecorativeMotion() {
  const [enabled, setEnabled] = useState(() =>
    !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(!document.hidden && !preference.matches);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return enabled;
}

function OrbitalTagline() {
  const animated = useDecorativeMotion();
  return animated ? (
    <ShinyText
      text="THE HUMAN SIDE OF SPACE"
      color="#b6c7cc"
      shineColor="#ffffff"
      speed={2.8}
      delay={3.2}
      glow={0.22}
      shineWidth={30}
      followPointer
      className="orbital-shiny-text"
    />
  ) : <span className="orbital-shiny-static">THE HUMAN SIDE OF SPACE</span>;
}

function OrbitalLaunchAura() {
  const animated = useDecorativeMotion();
  return animated ? (
    <StarBorder
      as="span"
      className="orbital-launch-aura"
      color="#fff3cf"
      trailColor="#ff9b5e"
      backgroundColor="transparent"
      borderColor="rgba(255, 244, 210, 0.2)"
      radius={12}
      duration={5.5}
      thickness={1.4}
      trailLength={0.25}
      glow={0.85}
      sparkle
      stars={2}
      hover="brighten"
      aria-hidden="true"
    />
  ) : <span className="orbital-launch-aura orbital-star-static" aria-hidden="true" />;
}

const mountedRoots = new Map();
/**
 * Call after the app's innerHTML has been written. The native launch button keeps
 * its own text, disabled state, keyboard activation and event handlers.
 * Hosts: #react-tagline and #launch-react (the latter inside #launch).
 * Repeated calls reuse roots. Returns a cleanup function for the mounted roots.
 */
export function mountReactBits() {
  const mounted = [];
  for (const [id, Component] of [
    ['react-tagline', OrbitalTagline],
    ['launch-react', OrbitalLaunchAura]
  ]) {
    const host = document.getElementById(id);
    if (!host) continue;
    let root = mountedRoots.get(host);
    if (!root) {
      root = createRoot(host);
      mountedRoots.set(host, root);
    }
    flushSync(() => root.render(<Component />));
    mounted.push([host, root]);
  }
  return () => {
    for (const [host, root] of mounted) {
      if (mountedRoots.get(host) !== root) continue;
      root.unmount();
      mountedRoots.delete(host);
    }
  };
}

export { StarBorder, ShinyText };
