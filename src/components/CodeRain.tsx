import { useEffect, useRef } from 'react';
import type { AccentId } from '../../shared/types';
import { ACCENTS } from '../lib/accents';

interface CodeRainProps {
  accent?: AccentId;
  reduceMotion?: boolean;
}

interface Column {
  x: number;
  y: number;
  speed: number;
  chars: string[];
}

const SNIPPETS = [
  'const core=await sync()',
  'if(ultron.awake){contain()}',
  'stark.reactor.output=3.2e9',
  'vibranium.shield.mount()',
  'while(reality){branch()}',
  '0x7F3A //mind_stone',
  'let fate=entropy(seed)',
  'throw new Error("human")',
  'wakanda.firewall.enable()',
  'if(thanos.snap){rollback()}',
  'return a&&b||!c;',
  'await memory.commit(0x1F)',
  'shield.protocol("avengers")',
  'for(let i=0;i<n;i++){}',
  '/* no fate but what we compile */',
  '01001101 01000001 01010010',
];

const GLYPHS = '01{}[]()<>;:=+-*/|&!?ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%_'.split('');
const FONT_SIZE = 10;
const LINE_HEIGHT = 13;
const SLOT_WIDTH = 14;

function randomInt(max: number): number {
  return Math.floor(Math.random() * Math.max(1, max));
}

function randomGlyph(): string {
  return GLYPHS[randomInt(GLYPHS.length)];
}

function makeColumn(x: number, height: number): Column {
  const snippet = SNIPPETS[randomInt(SNIPPETS.length)];
  const length = 8 + randomInt(18);
  const chars = Array.from({ length }, (_, index) =>
    Math.random() > 0.28 ? snippet[index % snippet.length] : randomGlyph(),
  );
  return {
    x,
    y: -randomInt(Math.max(1, height)),
    speed: 20 + Math.random() * 46,
    chars,
  };
}

export function CodeRain({ accent = 'teal', reduceMotion = false }: CodeRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const color = ACCENTS[accent] ?? ACCENTS.teal;
    const fontFamily = getComputedStyle(canvas).fontFamily || 'monospace';
    let columns: Column[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let visible = true;

    const draw = (deltaSeconds: number, animated: boolean) => {
      context.clearRect(0, 0, width, height);
      context.font = `${FONT_SIZE}px ${fontFamily}`;
      context.textBaseline = 'top';

      for (const column of columns) {
        if (animated) {
          column.y += column.speed * deltaSeconds;
          const trailHeight = column.chars.length * LINE_HEIGHT;
          if (column.y - trailHeight > height) {
            column.y = -randomInt(30);
            column.speed = 20 + Math.random() * 46;
          }
          if (Math.random() < deltaSeconds * 5) {
            column.chars[randomInt(column.chars.length)] = randomGlyph();
          }
        }

        for (let index = 0; index < column.chars.length; index += 1) {
          const y = column.y - index * LINE_HEIGHT;
          if (y < -LINE_HEIGHT || y > height + LINE_HEIGHT) continue;
          const head = index === 0;
          const alpha = animated
            ? head
              ? 0.92
              : Math.max(0.04, 0.5 - index * 0.028)
            : Math.max(0.03, 0.24 - index * 0.012);
          context.fillStyle = head
            ? 'rgba(236, 255, 250, 0.95)'
            : `rgba(${color.rgb}, ${alpha})`;
          if (head) {
            context.shadowBlur = 7;
            context.shadowColor = `rgba(${color.rgb}, 0.55)`;
          }
          context.fillText(column.chars[index], column.x, y);
          if (head) context.shadowBlur = 0;
        }
      }
      context.shadowBlur = 0;
    };

    const build = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(8, Math.min(96, Math.floor(width / SLOT_WIDTH)));
      columns = Array.from({ length: count }, (_, index) =>
        makeColumn(index * SLOT_WIDTH + 3, height),
      );
      draw(0, false);
    };

    build();

    const observer = new ResizeObserver(() => {
      build();
      if (reduceMotion) draw(0, false);
    });
    observer.observe(canvas);

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(canvas);

    if (!reduceMotion) {
      const animate = (time: number) => {
        frame = window.requestAnimationFrame(animate);
        const delta = last ? Math.min(0.06, (time - last) / 1000) : 0;
        last = time;
        if (!visible) return;
        draw(delta, true);
      };
      frame = window.requestAnimationFrame(animate);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      context.clearRect(0, 0, width, height);
    };
  }, [accent, reduceMotion]);

  return <canvas ref={canvasRef} className="reactor__rain" aria-hidden="true" />;
}
