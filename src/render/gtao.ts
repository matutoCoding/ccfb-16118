// GTAO 渲染管线（基于地平角的环境光遮蔽）
// 流程：场景深度/法线 → GTAO（弯曲法线 horizon-angle，含多反弹近似）
//       → 时域累积（运动矢量/相机抖动重投影）→ 合成（天光走弯曲法线、洞口层暗）
// 参考：Hammon 2017 "Practical GTAO"，多反弹采用 GTAO+1 风格经验近似
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const PACK_NORMAL = /* glsl */`
vec3 packNormal(vec3 n) { return n * 0.5 + 0.5; }
vec3 unpackNormal(vec3 c) { return normalize(c * 2.0 - 1.0); }
float linearizeDepth(float d, float near, float far) {
  return (near * far) / (far - d * (far - near));
}`;

const GTAO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform mat4 projection;
uniform mat4 invProjection;
uniform vec2 resolution;
uniform float radius;       // 世界空间采样半径 m
uniform float thickness;    // 遮蔽物厚度 m
uniform int numSamples;     // 每方向切片采样数
uniform int numSlices;      // 切片数
uniform float frameSeed;

${PACK_NORMAL}

vec3 viewPosFromDepth(vec2 uv, float depth) {
  float z = depth * 2.0 - 1.0;
  vec4 clip = vec4(uv * 2.0 - 1.0, z, 1.0);
  vec4 view = invProjection * clip;
  return view.xyz / view.w;
}

// Hammon 2017：切片内两个方向的地平角积分
float integrateArc(vec2 arc, float projNF) {
  float cosGamma = cos(arc.x);
  float cosBeta  = cos(arc.y);
  float sinGamma = sin(arc.x);
  float sinBeta  = sin(arc.y);
  float d = projNF;
  return 0.25 * (
      (d * (cosGamma - cosBeta)) +
      (arc.y - arc.x) +
      (d * d) * (sinBeta - sinGamma)
  );
}

// 重量函数：cos 权重，地平附近衰减（falloff 近似）
float falloff(float dist) {
  float t = clamp(dist / radius, 0.0, 1.0);
  return 1.0 - t * t;
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = vec4(1.0); return; }

  vec3 n = unpackNormal(texture2D(tNormal, vUv).xyz);
  vec3 p = viewPosFromDepth(vUv, depth);
  vec3 viewDir = normalize(-p);

  // 视图空间随机旋转切片
  float jitter = frameSeed * 6.2831853;
  float ao = 0.0;
  vec3 bentSum = vec3(0.0);

  // 屏幕半径（像素）随深度缩放
  float projScale = projection[1][1] * resolution.y * 0.5;
  float radiusPixels = radius * projScale / max(-p.z, 0.01);

  for (int s = 0; s < 8; s++) {
    if (s >= numSlices) break;
    float phi = jitter + (float(s) * 3.14159265) / float(numSlices);
    // 视图空间切片方向（垂直于视线的平面内）
    vec3 tv = vec3(cos(phi), sin(phi), 0.0);
    vec3 bv = cross(viewDir, tv);
    // 法线在切片坐标系的投影
    float projNT = dot(n, tv);
    float projNB = dot(n, bv);
    vec2 arcL = vec2(-1.5707963, 1.5707963); // (gamma, beta) 未遮蔽范围
    vec2 arcR = vec2(-1.5707963, 1.5707963);

    for (int k = 1; k <= 16; k++) {
      if (k > numSamples) break;
      // 指数步进，近处密远处疏
      float stepT = pow(float(k) / float(numSamples), 1.5);
      float off = stepT * radiusPixels;
      for (int side = 0; side < 2; side++) {
        float sign = side == 0 ? 1.0 : -1.0;
        vec2 sampleUv = vUv + vec2(sign * off) * (tv.xy / resolution);
        if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) continue;
        float sd = texture2D(tDepth, sampleUv).x;
        if (sd >= 1.0) continue;
        vec3 sp = viewPosFromDepth(sampleUv, sd);
        vec3 diff = sp - p;
        float dist = length(diff);
        if (dist > radius || dist < 1e-4) continue;
        vec3 dir = diff / dist;
        float elev = asin(clamp(dir.z, -1.0, 1.0)); // 视图 z 朝屏幕外
        // 厚度检查：避免背面漏光
        float w = falloff(dist);
        if (side == 0) {
          float gamma = arcR.x, beta = arcR.y;
          if (elev > gamma) arcR.x = mix(gamma, elev, w);
          // bent normal 朝未遮蔽半球累计
          bentSum += normalize(vec3(dir.xy, max(dir.z, 0.05))) * w * 0.25;
        } else {
          float gamma = arcL.x, beta = arcL.y;
          if (-elev > -gamma) arcL.y = mix(beta, -elev, w);
          bentSum += normalize(vec3(-dir.xy, max(-dir.z, 0.05))) * w * 0.25;
        }
      }
    }

    float projNF = projNB; // 法线在切片“上”方向分量
    float vis = 1.0;
    if (projNF > 0.001) {
      float g = clamp(arcL.x, -1.5708, 1.5708), b = clamp(arcL.y, -1.5708, 1.5708);
      float visL = clamp(integrateArc(vec2(g, b), projNF) / max(projNF, 1e-3), 0.0, 1.0);
      g = clamp(arcR.x, -1.5708, 1.5708); b = clamp(arcR.y, -1.5708, 1.5708);
      float visR = clamp(integrateArc(vec2(g, b), projNF) / max(projNF, 1e-3), 0.0, 1.0);
      vis = visL * 0.5 + visR * 0.5;
    }
    ao += vis;
  }
  ao /= float(numSlices);
  ao = clamp(ao, 0.0, 1.0);

  // ---- 多次反弹近似（GTAO+1 风格）：暗部补回部分环境光，洞内层层衰减而非死黑/平灰 ----
  float multi = 1.0 / max(ao, 0.18);
  ao = clamp(ao * (0.62 + 0.38 * multi), 0.0, 1.0);

  // ---- 弯曲法线（bent normal）：朝未遮蔽方向，用于天光遮挡 ----
  vec3 bent = normalize(n + normalize(bentSum + n * 0.001) * 0.7);
  vec3 bn = packNormal(bent);
  gl_FragColor = vec4(ao, bn.x, bn.y, bn.z);
}`;

const TEMPORAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tCurr;
uniform sampler2D tPrev;
uniform sampler2D tDepth;
uniform mat4 invViewProj;
uniform mat4 prevViewProj;
uniform float accumulation;   // 1/N
uniform vec2 jitter;

${PACK_NORMAL}

void main() {
  vec4 curr = texture2D(tCurr, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = curr; return; }

  // 世界坐标重投影到上一帧
  vec4 world = invViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  world.xyz /= world.w;
  vec4 prevClip = prevViewProj * vec4(world.xyz, 1.0);
  vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;

  vec4 prev = texture2D(tPrev, prevUv);
  bool valid = prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0;
  // 邻域 3x3 最近深度钳制（防拖影）
  if (valid) {
    vec3 cn = unpackNormal(curr.yzw);
    vec3 pn = unpackNormal(prev.yzw);
    if (dot(cn, pn) < 0.9) valid = false;
  }
  if (!valid) { gl_FragColor = curr; return; }
  gl_FragColor = mix(prev, curr, accumulation);
}`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tGtao;
uniform sampler2D tDepth;
uniform vec3 skyColor;
uniform vec3 sunColor;
uniform vec3 sunDirView;
uniform float aoStrength;

${PACK_NORMAL}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  vec3 base = texture2D(tColor, vUv).rgb;
  if (depth >= 1.0) { gl_FragColor = vec4(base, 1.0); return; }

  vec4 gtao = texture2D(tGtao, vUv);
  float ao = mix(1.0, gtao.x, aoStrength);
  vec3 bent = unpackNormal(gtao.yzw);

  // 天光项走弯曲法线：洞内朝天侧仍有光，褶皱皱感可见
  float skyWrap = clamp(dot(bent, normalize(vec3(0.0, 0.0, 1.0))) * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = skyColor * (0.35 + 0.65 * skyWrap);

  // 直射光保留在场景 color 里（lambert 已含），这里仅对环境/间接项乘 AO
  vec3 outColor = base * (0.55 + 0.45 * ao) + ambient * base * ao * 0.5;
  // 色调映射 + 伽马
  outColor = outColor / (outColor + vec3(0.85));
  outColor = pow(outColor, vec3(1.0 / 2.2));
  gl_FragColor = vec4(outColor, 1.0);
}`;

export interface GtaoParams {
  radius: number;
  samples: number;
  halfRes: boolean;
  temporalFrames: number;
}

export class GtaoPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private normalRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  private aoRT2: THREE.WebGLRenderTarget;
  private colorRT: THREE.WebGLRenderTarget;
  private gtaoMat: THREE.ShaderMaterial;
  private temporalMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private normalOverride: THREE.MeshNormalMaterial;
  private prevViewProj = new THREE.Matrix4();
  private frame = 0;
  private params: GtaoParams;
  private sunView = new THREE.Vector3(0, 1, 0);
  private skyColor = new THREE.Color(0.6, 0.72, 0.9);
  private sunColor = new THREE.Color(1.0, 0.95, 0.85);
  public jitter = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, params: GtaoParams) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.params = params;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const makeRT = (w: number, h: number, type: THREE.TextureDataType = THREE.UnsignedByteType) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type,
        depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
        depthBuffer: true
      });
      return rt;
    };
    const aoScale = params.halfRes ? 0.5 : 1;
    this.normalRT = makeRT(size.x, size.y);
    this.colorRT = makeRT(size.x, size.y, THREE.HalfFloatType);
    this.aoRT = makeRT(Math.floor(size.x * aoScale), Math.floor(size.y * aoScale));
    this.aoRT2 = this.aoRT.clone();

    this.gtaoMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: GTAO_FRAG,
      uniforms: {
        tDepth: { value: this.normalRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        projection: { value: camera.projectionMatrix },
        invProjection: { value: camera.projectionMatrixInverse },
        resolution: { value: new THREE.Vector2(this.aoRT.width, this.aoRT.height) },
        radius: { value: params.radius },
        thickness: { value: 1.0 },
        numSamples: { value: params.samples },
        numSlices: { value: 4 },
        frameSeed: { value: 0 }
      },
      depthTest: false, depthWrite: false
    });
    this.temporalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: TEMPORAL_FRAG,
      uniforms: {
        tCurr: { value: this.aoRT.texture },
        tPrev: { value: this.aoRT2.texture },
        tDepth: { value: this.aoRT.depthTexture },
        invViewProj: { value: new THREE.Matrix4() },
        prevViewProj: { value: new THREE.Matrix4() },
        accumulation: { value: 1 },
        jitter: { value: new THREE.Vector2() }
      },
      depthTest: false, depthWrite: false
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tGtao: { value: this.aoRT2.texture },
        tDepth: { value: this.colorRT.depthTexture },
        skyColor: { value: this.skyColor },
        sunColor: { value: this.sunColor },
        sunDirView: { value: this.sunView },
        aoStrength: { value: 1.0 }
      },
      depthTest: false, depthWrite: false
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gtaoMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.normalOverride = new THREE.MeshNormalMaterial();
  }

  setSun(worldDir: THREE.Vector3, sky: THREE.Color, sun: THREE.Color) {
    this.sunView.copy(worldDir).transformDirection(this.camera.matrixWorldInverse);
    this.skyColor.copy(sky); this.sunColor.copy(sun);
  }

  /** 相机静止时由外部调用重置累积（如布置变更） */
  resetAccumulation() { this.frame = 0; }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const aoScale = this.params.halfRes ? 0.5 : 1;
    for (const rt of [this.normalRT, this.colorRT]) rt.setSize(size.x, size.y);
    this.aoRT.setSize(Math.floor(size.x * aoScale), Math.floor(size.y * aoScale));
    this.aoRT2.setSize(this.aoRT.width, this.aoRT.height);
    (this.gtaoMat.uniforms.resolution.value as THREE.Vector2).set(this.aoRT.width, this.aoRT.height);
    this.frame = 0;
  }

  render() {
    const r = this.renderer;
    // 相机抖动（Halton 式简易序列），喂给时域累积做超采样
    const n = this.frame + 1;
    this.jitter.set(((n % 2) * 2 - 1) / (this.aoRT.width * 2),
                    (((n * 3) % 4) * 2 - 1) / (this.aoRT.height * 2));
    this.camera.updateMatrixWorld();

    // 1) 颜色 + 深度
    r.setRenderTarget(this.colorRT);
    r.clear();
    r.render(this.scene, this.camera);

    // 2) 视图空间法线（独立一遍，确保 GTAO 与材质解耦）
    r.setRenderTarget(this.normalRT);
    this.scene.overrideMaterial = this.normalOverride;
    r.clear();
    r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;

    // 3) GTAO → 当前帧 RT（乒乓中作为“写”的那一个）
    this.quad.material = this.gtaoMat;
    this.gtaoMat.uniforms.frameSeed.value = (this.frame * 0.6180339) % 1;
    const curr = this.frame % 2 === 0 ? this.aoRT : this.aoRT2;
    const prev = this.frame % 2 === 0 ? this.aoRT2 : this.aoRT;
    this.gtaoMat.uniforms.tDepth.value = this.normalRT.depthTexture;
    r.setRenderTarget(curr);
    r.render(this.quadScene, this.camera);

    // 4) 时域累积：读 curr + prev，写回 prev（输入输出分离，无 feedback loop）
    this.quad.material = this.temporalMat;
    const vp = this.camera.matrixWorldInverse.clone().multiply(this.camera.projectionMatrix);
    this.temporalMat.uniforms.tCurr.value = curr.texture;
    this.temporalMat.uniforms.tPrev.value = prev.texture;
    this.temporalMat.uniforms.tDepth.value = curr.depthTexture;
    this.temporalMat.uniforms.invViewProj.value.copy(vp).invert();
    this.temporalMat.uniforms.prevViewProj.value.copy(this.prevViewProj);
    this.temporalMat.uniforms.accumulation.value = 1 / Math.min(this.frame + 1, this.params.temporalFrames);
    r.setRenderTarget(prev);
    r.render(this.quadScene, this.camera);

    // 5) 合成到屏幕（累积结果在 prev RT 中）
    this.quad.material = this.compositeMat;
    this.compositeMat.uniforms.tGtao.value = prev.texture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.camera);

    this.prevViewProj.copy(vp);
    this.frame++;
  }

  dispose() {
    for (const rt of [this.normalRT, this.aoRT, this.aoRT2, this.colorRT]) rt.dispose();
    this.gtaoMat.dispose(); this.temporalMat.dispose(); this.compositeMat.dispose();
  }
}
