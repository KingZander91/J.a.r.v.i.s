import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AccentId, RunStatus } from '../../shared/types';
import { accentHex } from '../lib/accents';
import { cn } from '../lib/utils';
import { STATUS_LABELS } from '../lib/types';
import { CodeRain } from './CodeRain';

interface ReactorProps {
  accent?: AccentId;
  status?: RunStatus | null;
  runActive?: boolean;
  reduceMotion?: boolean;
  className?: string;
}

const SPEEDS: Record<RunStatus, number> = {
  idle: 0.62,
  listening: 1.1,
  thinking: 1.2,
  acting: 1.9,
  speaking: 1.35,
  awaiting_approval: 0.32,
  awaiting_input: 0.38,
  completed: 0.8,
  failed: 0.22,
  cancelled: 0.25,
  max_steps: 0.35,
};

const BLOOM: Record<RunStatus, number> = {
  idle: 0.72,
  listening: 0.95,
  thinking: 1.05,
  acting: 1.35,
  speaking: 1.2,
  awaiting_approval: 0.5,
  awaiting_input: 0.55,
  completed: 0.9,
  failed: 0.35,
  cancelled: 0.4,
  max_steps: 0.45,
};

function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function Reactor({
  accent = 'teal',
  status = 'idle',
  runActive = false,
  reduceMotion = false,
  className,
}: ReactorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const statusRef = useRef<RunStatus>(status ?? 'idle');
  const motionRef = useRef(reduceMotion);

  useEffect(() => {
    statusRef.current = status ?? 'idle';
  }, [status]);

  useEffect(() => {
    motionRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const color = new THREE.Color(accentHex(accent));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020709');
    scene.fog = new THREE.FogExp2('#020709', 0.036);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    camera.position.set(0, 1.65, 11.3);
    camera.lookAt(0, -0.05, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    renderer.setClearColor('#020709', 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.62, 0.12);
    composer.addPass(bloom);

    const rig = new THREE.Group();
    scene.add(rig);
    const root = new THREE.Group();
    root.position.y = 0.15;
    rig.add(root);

    const glowTexture = createGlowTexture();
    glowTexture.colorSpace = THREE.SRGBColorSpace;

    const additive = (opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

    const lineMaterial = (opacity: number) =>
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

    /* Central core -------------------------------------------------- */
    const spin = new THREE.Group();
    root.add(spin);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(5.2, 5.2, 1);
    root.add(halo);

    const innerCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 2), additive(0.92));
    spin.add(innerCore);

    const innerWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.08, 1),
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spin.add(innerWire);

    const middleWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.62, 1),
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    spin.add(middleWire);

    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.94, 0.012, 260, 8, 2, 3), additive(0.5));
    spin.add(knot);

    const beamMaterial = additive(0.14);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 9, 6), beamMaterial);
    beam.position.y = 0;
    root.add(beam);

    const beamCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 7, 8, 1, true),
      additive(0.035),
    );
    root.add(beamCore);

    /* Orbiting rings ------------------------------------------------ */
    const ringGroups: Array<{ group: THREE.Group; baseX: number; baseZ: number; speed: number }> = [];
    const ringConfig = [
      { radius: 2.25, tiltX: 1.22, tiltZ: 0.12, opacity: 0.3, speed: 0.1 },
      { radius: 2.85, tiltX: 0.72, tiltZ: -0.48, opacity: 0.2, speed: -0.07 },
      { radius: 3.4, tiltX: 1.52, tiltZ: 0.32, opacity: 0.16, speed: 0.045 },
      { radius: 3.95, tiltX: 1.05, tiltZ: 0.78, opacity: 0.1, speed: -0.03 },
    ];

    ringConfig.forEach((config, index) => {
      const group = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius, 0.006, 3, 220),
        additive(config.opacity),
      );
      group.add(base);

      const arcOne = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius, 0.017, 4, 100, Math.PI * (0.55 + index * 0.08)),
        additive(0.55),
      );
      arcOne.rotation.z = index * 1.7;
      group.add(arcOne);

      const arcTwo = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius + 0.02, 0.012, 4, 90, Math.PI * 0.32),
        additive(0.36),
      );
      arcTwo.rotation.z = index * 2.2 + Math.PI;
      group.add(arcTwo);

      if (index === 1) {
        const positions: number[] = [];
        for (let tick = 0; tick < 72; tick += 1) {
          const angle = (tick / 72) * Math.PI * 2;
          const major = tick % 6 === 0;
          const inner = config.radius - (major ? 0.17 : 0.07);
          const outer = config.radius + (major ? 0.17 : 0.07);
          positions.push(
            Math.cos(angle) * inner,
            Math.sin(angle) * inner,
            0,
            Math.cos(angle) * outer,
            Math.sin(angle) * outer,
            0,
          );
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const ticks = new THREE.LineSegments(geometry, lineMaterial(0.3));
        group.add(ticks);
      }

      group.rotation.x = config.tiltX;
      group.rotation.z = config.tiltZ;
      root.add(group);
      ringGroups.push({
        group,
        baseX: config.tiltX,
        baseZ: config.tiltZ,
        speed: config.speed,
      });
    });

    /* Particle field ------------------------------------------------ */
    const dustGeometry = new THREE.BufferGeometry();
    const dustCount = 900;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    const cool = new THREE.Color('#1a5c55');
    for (let i = 0; i < dustCount; i += 1) {
      const radius = 2.1 + Math.pow(Math.random(), 0.7) * 5.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      dustPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      dustPositions[i * 3 + 1] = Math.cos(phi) * radius * 0.6;
      dustPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      const mix = Math.random();
      const dustColor = mix > 0.82 ? color : cool;
      dustColors[i * 3] = dustColor.r;
      dustColors[i * 3 + 1] = dustColor.g;
      dustColors[i * 3 + 2] = dustColor.b;
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
    const dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        size: 0.045,
        map: glowTexture,
        transparent: true,
        opacity: 0.72,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    scene.add(dust);

    const sparkGeometry = new THREE.BufferGeometry();
    const sparkCount = 70;
    const sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i += 1) {
      const radius = 2.4 + Math.random() * 2.8;
      const angle = Math.random() * Math.PI * 2;
      sparkPositions[i * 3] = Math.cos(angle) * radius;
      sparkPositions[i * 3 + 1] = (Math.random() - 0.5) * 4.6;
      sparkPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    const sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({
        size: 0.15,
        map: glowTexture,
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(sparks);

    /* Floor grid ---------------------------------------------------- */
    const grid = new THREE.GridHelper(22, 44, new THREE.Color(accentHex(accent)), new THREE.Color('#0b2421'));
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.13;
      material.depthWrite = false;
    });
    grid.position.y = -3.1;
    scene.add(grid);

    const discMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.RingGeometry(1.4, 4.8, 96), discMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -2.5;
    scene.add(disc);

    /* Interaction --------------------------------------------------- */
    const pointer = { x: 0, y: 0 };
    const handlePointer = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      pointer.y = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1;
    };
    const handleLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    container.addEventListener('pointermove', handlePointer);
    container.addEventListener('pointerleave', handleLeave);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let frame = 0;
    let speed = SPEEDS[statusRef.current] ?? 0.7;
    const clock = new THREE.Clock();
    let visible = true;
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.02 },
    );
    visibilityObserver.observe(container);

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (!visible) return;

      const elapsed = clock.getElapsedTime();
      const targetSpeed = SPEEDS[statusRef.current] ?? 0.7;
      const motionScale = motionRef.current ? 0.12 : 1;
      speed += (targetSpeed - speed) * 0.035;
      const motion = speed * motionScale;

      spin.rotation.y += 0.0038 * motion;
      spin.rotation.x = Math.sin(elapsed * 0.17) * 0.16;
      innerCore.rotation.y -= 0.0025 * motion;
      knot.rotation.z += 0.0022 * motion;
      middleWire.rotation.y -= 0.0009 * motion;
      halo.scale.setScalar(5.05 + Math.sin(elapsed * 1.2) * 0.16 + speed * 0.1);

      ringGroups.forEach((ring, index) => {
        ring.group.rotation.z += ring.speed * 0.01 * motion;
        ring.group.rotation.x =
          ring.baseX + Math.sin(elapsed * (0.16 + index * 0.04)) * 0.09 * motionScale;
      });

      dust.rotation.y = elapsed * 0.012 * motion;
      dust.rotation.x = Math.sin(elapsed * 0.05) * 0.06;
      sparks.rotation.y = -elapsed * 0.05 * motion;
      disc.rotation.z += 0.0008 * motion;

      if (!motionRef.current) {
        rig.rotation.y += (pointer.x * 0.17 - rig.rotation.y) * 0.035;
        rig.rotation.x += (pointer.y * 0.1 - rig.rotation.x) * 0.035;
        root.position.y = 0.15 + Math.sin(elapsed * 0.55) * 0.09;
      }

      const targetBloom = BLOOM[statusRef.current] ?? 0.8;
      bloom.strength += (targetBloom - bloom.strength) * 0.03;
      composer.render();
    };

    const targetBloom = BLOOM[statusRef.current] ?? 0.8;
    bloom.strength = targetBloom;
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      container.removeEventListener('pointermove', handlePointer);
      container.removeEventListener('pointerleave', handleLeave);
      glowTexture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose();
        }
      });
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [accent]);

  const currentStatus = (status ?? 'idle') as RunStatus;
  const label = runActive ? STATUS_LABELS[currentStatus] : 'Standby';

  return (
    <div
      className={cn('reactor', failed && 'reactor--fallback', className)}
      data-status={currentStatus}
      role="img"
      aria-label={`Holographic reactor core. Status: ${label}.`}
    >
      <div ref={containerRef} className="reactor__canvas" aria-hidden="true" />
      <CodeRain accent={accent} reduceMotion={reduceMotion} />
      {failed && (
        <div className="reactor__fallback-visual" aria-hidden="true">
          <span className="reactor__fallback-core" />
          <span className="reactor__fallback-ring reactor__fallback-ring--one" />
          <span className="reactor__fallback-ring reactor__fallback-ring--two" />
          <span className="reactor__fallback-ring reactor__fallback-ring--three" />
        </div>
      )}

      <div className="reactor__vignette" aria-hidden="true" />
      <span className="reactor__bracket reactor__bracket--tl" aria-hidden="true" />
      <span className="reactor__bracket reactor__bracket--tr" aria-hidden="true" />
      <span className="reactor__bracket reactor__bracket--bl" aria-hidden="true" />
      <span className="reactor__bracket reactor__bracket--br" aria-hidden="true" />

      <div className="reactor__hud reactor__hud--tl">
        <span className="hud-dot" />
        Stark reactor // MK IV
      </div>
      <div className="reactor__hud reactor__hud--tr">
        Sync <strong>99.84%</strong>
      </div>
      <div className="reactor__hud reactor__hud--ml">
        <span className="hud-label">Neural load</span>
        <span className="hud-bars" aria-hidden="true">
          <i style={{ height: '38%' }} />
          <i style={{ height: '64%' }} />
          <i style={{ height: '46%' }} />
          <i style={{ height: '82%' }} />
          <i style={{ height: '55%' }} />
          <i style={{ height: '72%' }} />
        </span>
        <strong>42.7</strong>
      </div>
      <div className="reactor__hud reactor__hud--mr">
        <span className="hud-label">Core temp</span>
        <strong>3.18 K</strong>
      </div>
      <div className="reactor__hud reactor__hud--bl">
        <span className="hud-label">GRID</span>
        <span className="mono">44.31 / 09.12</span>
      </div>
      <div className="reactor__hud reactor__hud--br">
        <span className="hud-label">Status</span>
        <strong className="hud-status">{label.toUpperCase()}</strong>
      </div>

      <div className="reactor__caption" aria-hidden="true">
        <span />
        STARK ARC REACTOR · {runActive ? 'ENERGISED' : 'STABLE'}
        <span />
      </div>
      <span className="reactor__axis reactor__axis--left" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
      <span className="reactor__axis reactor__axis--bottom" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
    </div>
  );
}
