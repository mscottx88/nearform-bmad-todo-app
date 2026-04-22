import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';

// Story 2.8: per-pad additive halo on the water surface. Lives inside
// the LilyPad group tree so its position tracks the pad; LilyPad's
// useFrame mutates this material's `uColor` / `uStrength` uniforms
// alongside the pad body/rim updates. Existing Bloom pass at
// luminanceThreshold 0.2 picks up the HDR-bright output and blurs it
// into a soft feathered halo on the water.
//
// Mesh is always mounted (no phase-gated mount/unmount); when strength
// is 0 the shader math naturally produces vec4(0,0,0,0) so the mesh
// renders a null contribution.
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Radial falloff across the disc: bright at the center, zero at the rim.
// `smoothstep(0.0, 0.5, d)` over vUv-distance from center (range 0..~0.707)
// gives a cosine-like ease that reads as a soft bloom-core rather than a
// hard-edged spotlight.
//
// Alpha MUST stay at 1.0 for correct additive contribution: THREE's
// AdditiveBlending uses `src.rgb * src.alpha + dst.rgb`. If we wrote
// alpha = strength*falloff and rgb = color*strength*falloff, the
// framebuffer would receive color * (strength*falloff)² — a squared
// attenuation that makes the halo nearly invisible at moderate
// strength. Keeping alpha=1 makes the blend `color*strength*falloff + dst`.
const fragmentShader = `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5));
    float falloff = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(uColor * uStrength * falloff, 1.0);
  }
`;

interface GlowSourceProps {
  radius: number;
  yOffset: number;
  /** Initial color expressed as a CSS/Three.js color string (e.g. "#ffffff").
   *  Defaults to black (invisible). For static cluster-ring halos; the
   *  primary pad halo overrides uniforms imperatively via `ref` each frame. */
  color?: string;
  /** Initial uStrength uniform. 0 by default (parent drives it via ref). */
  strength?: number;
}

export const GlowSource = forwardRef<THREE.ShaderMaterial, GlowSourceProps>(
  function GlowSource({ radius, yOffset, color, strength }, ref) {
    // Initialize uniforms once — LilyPad writes to .value directly each
    // frame for the primary glow. The cluster-ring variant uses static
    // `color` + `strength` props baked in at mount time.
    const uniforms = useMemo(
      () => {
        const c = new THREE.Color(color ?? '#000000');
        return {
          uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
          uStrength: { value: strength ?? 0 },
        };
      },
      // Mount-only: parent writes .value imperatively for animated halos;
      // static props are only read once at mount. eslint-disable-next-line
      // react-hooks/exhaustive-deps
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    return (
      <mesh position={[0, yOffset, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <circleGeometry args={[radius, 48]} />
        <shaderMaterial
          ref={ref}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>
    );
  },
);
