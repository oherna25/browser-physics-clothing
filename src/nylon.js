import * as THREE from 'three';
import { patternTexture, repaint } from './colourway.js';

// Sheer knit shader. Opacity is modelled as optical depth through the fabric:
// more thread is in the way at grazing angles (dark silhouette edges), and
// less where the knit is stretched (skin shows through the pulled region).
export function nylonMaterial(lightDir) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(0x0d0d12) },
      uSheen: { value: new THREE.Color(0x9aa0b4) },
      uLightDir: { value: lightDir.clone() },
      uDensity: { value: 0.55 },
      uAmbient: { value: 0.3 },
      uPattern: { value: patternTexture(4, 512) }, // colour along the leg, sampled by v
      uPatterned: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aStretch;
      attribute float aPre;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vStretch;
      varying float vPre;
      void main() {
        vNormal = normal;
        vUv = uv;
        vStretch = aStretch;
        vPre = aPre;
        vWorld = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSheen;
      uniform vec3 uLightDir;
      uniform float uDensity;
      uniform float uAmbient;
      uniform sampler2D uPattern;
      uniform float uPatterned;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vStretch;
      varying float vPre;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (!gl_FrontFacing) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        // Micro-weave: fine rib pattern, faded out where it would alias.
        vec2 w = vUv * vec2(260.0, 900.0);
        float fade = 1.0 - clamp(max(fwidth(w.x), fwidth(w.y)) * 1.2, 0.0, 1.0);
        float weave = 0.5 + 0.5 * sin(w.x * 6.2832) * sin(w.y * 6.2832);

        float stretch = max(vStretch * vPre, 1.0);
        float welt = smoothstep(0.04, 0.03, vUv.y); // reinforced band at the cuff
        float density = uDensity * mix(1.0, 4.5, welt) * mix(1.0, 0.7 + 0.6 * weave, fade * 0.6);
        density /= stretch * stretch; // area grows, thread count does not
        float alpha = 1.0 - exp(-density / max(ndv, 0.1));

        float diffuse = 0.35 + 0.65 * clamp(dot(N, uLightDir), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 3.0);
        vec3 H = normalize(uLightDir + V);
        float spec = pow(clamp(dot(N, H), 0.0, 1.0), 48.0);
        float sky = 0.5 + 0.5 * N.y;
        vec3 base = uColor;
        if (uPatterned > 0.5) base = texture2D(uPattern, vec2(0.5, vUv.y)).rgb;
        vec3 color = base * (diffuse + uAmbient * sky) + uSheen * (fresnel * 0.22 + spec * 0.28) * (0.6 + 0.4 * stretch);

        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  return mat;
}

// A solid entry takes the plain uniform path; a patterned one paints the 1D pattern texture.
export function setNylonColour(mat, entry) {
  const u = mat.uniforms;
  u.uSheen.value.set(entry.sheen);
  if (entry.pattern && entry.pattern !== 'solid') {
    repaint(u.uPattern.value, entry);
    u.uPatterned.value = 1;
  } else {
    u.uColor.value.set(entry.color);
    u.uPatterned.value = 0;
  }
}
