/**
 * Mapping the Unmeasured — fixed-coordinate, interactive model landscape.
 *
 * No build step is required. The local Three.js copy is pinned in vendor/.
 * Display meshes are visual interpolations; every selectable point retains
 * its original seven inputs and raw MPa prediction. The decorative breath
 * deforms the rendered model skin only. Data arrays, point anchors and MPa
 * predictions remain fixed; the synthetic reference is a static sparse wireframe.
 */
import * as THREE from './vendor/three.module.js';

const INK = '#315b7b';
const COPPER = '#c86c3a';
const TEAL = '#46a3a8';
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const idOf = point => point?.['Sample ID'] ?? point?.sample_id ?? point?.id;
const ease = t => t * t * (3 - 2 * t);

function interpolate(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] * (1 - t) + ys[hi] * t;
}

// Shape-preserving cubic Hermite interpolation, matching scipy PchipInterpolator.
// Values beyond the frozen anchor range follow the original linear end segment.
function makeDisplayMapping(xs, ys) {
  const h = [], delta = [], slopes = new Array(xs.length);
  for (let i = 0; i < xs.length - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / h[i]);
  }
  if (xs.length === 2) slopes[0] = slopes[1] = delta[0];
  else {
    for (let i = 1; i < xs.length - 1; i++) {
      if (!delta[i - 1] || !delta[i] || Math.sign(delta[i - 1]) !== Math.sign(delta[i])) slopes[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
    }
    const endpoint = (h0, h1, d0, d1) => {
      let d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(d) !== Math.sign(d0)) d = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d) > Math.abs(3 * d0)) d = 3 * d0;
      return d;
    };
    slopes[0] = endpoint(h[0], h[1], delta[0], delta[1]);
    const n = h.length - 1;
    slopes[xs.length - 1] = endpoint(h[n], h[n - 1], delta[n], delta[n - 1]);
  }
  return x => {
    if (x <= xs[0]) return ys[0] + (x - xs[0]) * delta[0];
    if (x >= xs[xs.length - 1]) return ys.at(-1) + (x - xs.at(-1)) * delta.at(-1);
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * slopes[lo]
      + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h[lo] * slopes[hi];
  };
}

function disposeTree(group) {
  for (const child of [...group.children]) {
    child.traverse(item => {
      item.geometry?.dispose();
      for (const material of (Array.isArray(item.material) ? item.material : [item.material])) {
        material?.dispose();
      }
    });
    group.remove(child);
  }
}

function markerTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const c = canvas.getContext('2d');
  c.translate(48, 48);
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#ffffff';
  c.lineJoin = 'round';
  if (kind === 'hexagon') {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      c.lineTo(Math.cos(a) * 35, Math.sin(a) * 35);
    }
    c.closePath(); c.fill();
  } else if (kind === 'triangle') {
    c.beginPath(); c.moveTo(0, -37); c.lineTo(36, 30); c.lineTo(-36, 30); c.closePath(); c.fill();
  } else if (kind === 'cross') {
    c.lineWidth = 9;
    c.beginPath(); c.moveTo(-27, -27); c.lineTo(27, 27); c.moveTo(-27, 27); c.lineTo(27, -27); c.stroke();
  } else if (kind === 'plus') {
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(-31, 0); c.lineTo(31, 0); c.moveTo(0, -31); c.lineTo(0, 31); c.stroke();
    c.globalCompositeOperation = 'destination-out'; c.fillRect(-7, -7, 14, 14);
  } else if (kind === 'ring') {
    c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 31, 0, TAU); c.stroke();
    c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
  } else if (kind === 'glow') {
    const gradient = c.createRadialGradient(0, 0, 0, 0, 0, 45);
    gradient.addColorStop(0, 'rgba(255,255,255,.7)');
    gradient.addColorStop(.3, 'rgba(255,255,255,.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gradient; c.fillRect(-48, -48, 96, 96);
  } else {
    c.beginPath(); c.arc(0, 0, 35, 0, TAU); c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {HTMLElement} container A position:relative element with a real height.
 * @param {{onSelect?:(point:Object)=>void}} options
 * @returns {Promise<{setScene:Function,highlight:Function,setQuery:Function,
 *  resetView:Function,setBreathing:Function,setReferenceVisible:Function,dispose:Function}>}
 */
export async function createHero(container, { onSelect = () => {} } = {}) {
  const world = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 150);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0xf6f5f0, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(pointer:coarse)').matches ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab', outline: 'none' });
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive model landscape. Drag to rotate, scroll to zoom, click a sample to inspect. Arrow keys rotate; plus and minus zoom; Home resets the view.');
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  overlay.setAttribute('aria-hidden', 'true');
  container.appendChild(overlay);
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'absolute', display: 'none', zIndex: '2', color: '#37473d',
    font: '10px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
    padding: '8px 10px', whiteSpace: 'nowrap', background: 'rgba(250,249,245,.96)',
    boxShadow: '0 3px 18px #25322b0d', border: '1px solid #d8ded3', borderRadius: '4px',
  });
  overlay.appendChild(tooltip);
  const queryLabel = document.createElement('div');
  Object.assign(queryLabel.style, {
    position: 'absolute', display: 'none', color: '#9a4e27', background: 'rgba(250,249,245,.96)',
    border: '1px solid #caab92', borderRadius: '4px', padding: '6px 9px',
    font: '10px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace', whiteSpace: 'nowrap',
  });
  overlay.appendChild(queryLabel);

  const axesGroup = new THREE.Group(), fixedGroup = new THREE.Group(), evidenceGroup = new THREE.Group();
  const highlightGroup = new THREE.Group(), queryGroup = new THREE.Group();
  world.add(axesGroup, fixedGroup, evidenceGroup, highlightGroup, queryGroup);
  world.add(new THREE.AmbientLight(0xffffff, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(-8, 18, 12); world.add(keyLight);
  const sideLight = new THREE.DirectionalLight(0xe7dbea, .45);
  sideLight.position.set(12, 5, -14); world.add(sideLight);

  const textures = Object.fromEntries(['hexagon', 'triangle', 'cross', 'plus', 'ring', 'glow', 'dot'].map(kind => [kind, markerTexture(kind)]));
  let width = 1, height = 1, sceneData = null, pointMap = new Map(), labels = [];
  let mapping = null, bounds = null, predictionMesh = null, referenceMesh = null, referenceCloud = null, morpher = null;
  let referenceVisible = true;
  let highlightIds = [], highlightKind = 'target', queryPoint = null;
  let breathing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let disposed = false, frame = 0, lastFrame = 0, yaw = Math.PI / 4, elevation = 35.264389682754654 * DEG, zoom = 1;
  let drag = null, hover = null, lastHoverTime = 0, pointer = null;
  const projected = new THREE.Vector3();
  const target = new THREE.Vector3(0, 0, 0);
  // GPU-only display displacement: 6.8-second cycle, about 2% of plot height.
  // The raw BufferAttributes and all numerical point positions stay unchanged.
  const breathUniforms = {
    uBreathPhase: { value: 0 }, uBreathAmount: { value: 0 },
    uQueryXZ: { value: new THREE.Vector2() }, uHasQuery: { value: 0 },
  };
  let breathAmount = 0;

  function positionCamera() {
    const horizontal = Math.cos(elevation) * 45;
    camera.position.set(Math.sin(yaw) * horizontal, Math.sin(elevation) * 45, Math.cos(yaw) * horizontal);
    camera.lookAt(target);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function resize() {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    // Fit the projected box and its axis labels in either a wide exhibition
    // panel or a narrow responsive panel, without clipping the UMAP corners.
    const vertical = Math.max(20.7, 17.8 / (width / height));
    camera.left = -vertical * width / height / 2;
    camera.right = vertical * width / height / 2;
    camera.top = vertical / 2; camera.bottom = -vertical / 2;
    positionCamera();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); resize();

  function worldPosition(x, y, displayZ) {
    return [(x - bounds.cx) * bounds.xyScale, (displayZ - bounds.floor) * bounds.zScale - bounds.worldHeight / 2,
      -(y - bounds.cy) * bounds.xyScale];
  }
  function pointPosition(point, layer = 'prediction') {
    let display;
    if (layer === 'floor') display = bounds.floor;
    else if (layer === 'observation') display = point.observation_display_z ?? mapping(point.synthetic_observation_mpa);
    else display = point.prediction_display_z ?? mapping(point.prediction_mpa);
    return worldPosition(point.UMAP_1, point.UMAP_2, display);
  }
  function pointGeometry(positions) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
    return geometry;
  }
  function dots(positions, { color = INK, size = 5, opacity = 1, shape = 'dot', depthTest = true } = {}) {
    const material = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true,
      opacity, depthWrite: false, depthTest, map: textures[shape], alphaTest: .025 });
    const object = new THREE.Points(pointGeometry(positions), material);
    object.frustumCulled = false;
    return object;
  }
  function lines(segments, { color = INK, opacity = .2, dashed = false, depthTest = true } = {}) {
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, opacity, transparent: true, dashSize: .075, gapSize: .075, depthWrite: false, depthTest })
      : new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false, depthTest });
    const object = new THREE.LineSegments(pointGeometry(segments.flat()), material);
    if (dashed) object.computeLineDistances();
    return object;
  }
  function axisLabel(text, position, { size = 9, color = '#829080', rotate = 0, dx = 0, dy = 0 } = {}) {
    const element = document.createElement('span');
    element.textContent = text;
    Object.assign(element.style, { position: 'absolute', whiteSpace: 'nowrap', color,
      font: `${size}px "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`,
      lineHeight: '1', opacity: '.8', userSelect: 'none', transformOrigin: '50% 50%' });
    overlay.appendChild(element);
    labels.push({ element, position: new THREE.Vector3(...position), rotate, dx, dy });
  }

  function buildAxes() {
    disposeTree(axesGroup);
    labels.forEach(label => label.element.remove()); labels = [];
    const { xmin, xmax, ymin, ymax, floor, ceiling } = bounds;
    const segments = [];
    const p = (x, y, z) => worldPosition(x, y, z);
    const xticks = [], yticks = [];
    for (let x = Math.ceil(xmin / 2) * 2; x < xmax; x += 2) xticks.push(x);
    for (let y = Math.ceil(ymin / 2) * 2; y < ymax; y += 2) yticks.push(y);
    const ticks = [0.2054840389, .82371914, 1.23266653396, 2.28427812957, 4.1212544, 7.3542285, 17.2383877018];
    for (const x of xticks) {
      segments.push([p(x, ymin, floor), p(x, ymax, floor)], [p(x, ymax, floor), p(x, ymax, ceiling)]);
      axisLabel(String(x), p(x, ymin - .2, floor), { dy: 15 });
    }
    for (const y of yticks) {
      segments.push([p(xmin, y, floor), p(xmax, y, floor)], [p(xmin, y, floor), p(xmin, y, ceiling)]);
      axisLabel(String(y), p(xmax + .18, y, floor), { dx: 14, dy: 8 });
    }
    for (const value of ticks) {
      const z = mapping(value);
      segments.push([p(xmin, ymin, z), p(xmin, ymax, z)], [p(xmin, ymax, z), p(xmax, ymax, z)]);
      axisLabel(value < 1 ? value.toPrecision(3) : value.toPrecision(3).replace(/0+$/, ''), p(xmax, ymax, z), { dx: 22, size: 8 });
    }
    axesGroup.add(lines(segments, { color: '#a9b4a8', opacity: .115 }));
    axesGroup.add(lines([
      [p(xmin, ymin, floor), p(xmax, ymin, floor)], [p(xmax, ymin, floor), p(xmax, ymax, floor)],
      [p(xmax, ymax, floor), p(xmax, ymax, ceiling)], [p(xmin, ymax, floor), p(xmin, ymax, ceiling)],
      [p(xmin, ymin, floor), p(xmin, ymin, ceiling)], [p(xmin, ymin, ceiling), p(xmin, ymax, ceiling)],
      [p(xmin, ymax, ceiling), p(xmax, ymax, ceiling)],
    ], { color: '#71816f', opacity: .22 }));
    axisLabel('UMAP 1', p((xmin + xmax) / 2, ymin - .52, floor), { size: 9, color: '#66785f', dy: 35, rotate: 28 });
    axisLabel('UMAP 2', p(xmax + .5, (ymin + ymax) / 2, floor), { size: 9, color: '#66785f', dx: 31, dy: 24, rotate: -28 });
    axisLabel('STRENGTH / MPa', p(xmax, ymax, .45), { size: 9, color: '#66785f', dx: 54, rotate: -90 });
  }

  function colorsFor(data) {
    const { mesh, residual_color_norm: norm } = data;
    const palette = data.residual_palette.map(value => new THREE.Color(value));
    const colors = new Float32Array(mesh.xy.length * 3);
    const c = new THREE.Color(), paper = new THREE.Color('#f6f5f0');
    for (let i = 0; i < mesh.xy.length; i++) {
      const residual = mesh.residual_mpa?.[i] ?? (mesh.prediction_mpa[i] - mesh.reference_mpa[i]);
      const f = interpolate(residual, norm.anchor_mpa, norm.anchor_color_fraction);
      c.copy(palette[f <= .5 ? 0 : 1]).lerp(palette[f <= .5 ? 1 : 2], f <= .5 ? f * 2 : (f - .5) * 2);
      c.lerp(paper, .025);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    return colors;
  }
  function meshPositions(data, field) {
    const positions = new Float32Array(data.mesh.xy.length * 3);
    for (let i = 0; i < data.mesh.xy.length; i++) {
      const xy = data.mesh.xy[i], pos = worldPosition(xy[0], xy[1], data.mesh[field][i]);
      positions.set(pos, i * 3);
    }
    return positions;
  }
  function buildSurface(data) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(meshPositions(data, 'prediction_display_z'), 3));
    geometry.setIndex(data.mesh.triangles.flat());
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsFor(data), 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, transparent: false,
      side: THREE.DoubleSide, depthWrite: true, roughness: .86, metalness: 0,
    });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, breathUniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        uniform float uBreathPhase;
        uniform float uBreathAmount;
        uniform vec2 uQueryXZ;
        uniform float uHasQuery;
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float envelope = 0.78 + 0.22 * cos(position.x * 0.44) * cos(position.z * 0.37);
        float swell = 0.24 * sin(uBreathPhase) * envelope;
        float ripple = 0.045 * sin(uBreathPhase + position.x * 0.63 - position.z * 0.48);
        float pin = mix(1.0, smoothstep(0.16, 1.0, distance(position.xz, uQueryXZ)), uHasQuery);
        transformed.y += (swell + ripple) * uBreathAmount * pin;
      `);
    };
    material.customProgramCacheKey = () => 'mapping-unmeasured-breath-v1';
    const surface = new THREE.Mesh(geometry, material);
    surface.frustumCulled = false; surface.renderOrder = 2;
    return surface;
  }

  function buildReference(data) {
    // The approved shared mesh contains a regular grid plus exact sample XY.
    // Recover only the repeated grid coordinates, then draw sparse cross-sections
    // at their actual reference heights. A second filled surface would blend
    // two layers of translucent colour and obscure the signed model error.
    const countX = new Map(), countY = new Map(), index = new Map();
    data.mesh.xy.forEach(([x, y], i) => {
      countX.set(x, (countX.get(x) || 0) + 1);
      countY.set(y, (countY.get(y) || 0) + 1);
      index.set(`${x}|${y}`, i);
    });
    const gridCoordinates = counts => {
      const threshold = Math.max(...counts.values()) * .75;
      return [...counts].filter(([, count]) => count >= threshold).map(([value]) => value).sort((a, b) => a - b);
    };
    const xs = gridCoordinates(countX), ys = gridCoordinates(countY);
    const segments = [];
    const at = (x, y) => {
      const i = index.get(`${x}|${y}`);
      return i === undefined ? null : worldPosition(x, y, data.mesh.reference_display_z[i]);
    };
    const sparse = values => values.filter((_, i) => i % 9 === 0 || i === values.length - 1);
    for (const x of sparse(xs)) {
      for (let i = 1; i < ys.length; i++) {
        const a = at(x, ys[i - 1]), b = at(x, ys[i]);
        if (a && b) segments.push([a, b]);
      }
    }
    for (const y of sparse(ys)) {
      for (let i = 1; i < xs.length; i++) {
        const a = at(xs[i - 1], y), b = at(xs[i], y);
        if (a && b) segments.push([a, b]);
      }
    }
    const wire = lines(segments, { color: '#63736b', opacity: .32 });
    wire.renderOrder = 3;
    wire.visible = referenceVisible;
    return wire;
  }
  function buildEvidence() {
    disposeTree(evidenceGroup);
    const points = sceneData.points;
    const floorPoints = dots(points.map(p => pointPosition(p, 'floor')), { color: '#9daea3', size: 1.4, opacity: .48 });
    floorPoints.renderOrder = 0; evidenceGroup.add(floorPoints);
    const cloud = dots(points.map(p => pointPosition(p, 'observation')), { color: '#7e8a83', size: 1.4, opacity: .09 });
    referenceCloud = cloud; cloud.visible = referenceVisible;
    cloud.renderOrder = 1; evidenceGroup.add(cloud);

    const clusterEdges = (sceneData.initial_cluster_edges || []).map(edge => [
      worldPosition(edge.rep_x, edge.rep_y, bounds.floor), worldPosition(edge.member_x, edge.member_y, bounds.floor),
    ]);
    evidenceGroup.add(lines(clusterEdges, { opacity: .15 }));
    const acquiredEdges = (sceneData.acquisition_edges || []).filter(edge => edge.kind === 'hybrid' || edge.kind === 'active_learning')
      .flatMap(edge => {
        const from = pointMap.get(edge['Sample ID'] ?? edge.sample_id), to = pointMap.get(edge.reference_id);
        return from && to ? [[pointPosition(from, 'floor'), pointPosition(to, 'floor')]] : [];
      });
    evidenceGroup.add(lines(acquiredEdges, { opacity: .30, dashed: true }));
    const acquired = points.filter(p => p.trained && p.kind !== 'kickstart');
    evidenceGroup.add(lines(acquired.map(p => [pointPosition(p, 'floor'), pointPosition(p, 'observation')]), { opacity: .10 }));
    for (const [kind, shape, color, size] of [
      ['kickstart', 'hexagon', INK, 7.5], ['hybrid', 'triangle', INK, 9],
      ['active_learning', 'triangle', INK, 9], ['random_exploration', 'cross', TEAL, 7],
    ]) {
      const positions = points.filter(p => p.trained && p.kind === kind).map(p => pointPosition(p, 'floor'));
      if (positions.length) {
        const marks = dots(positions, { color, size, opacity: .88, shape });
        marks.renderOrder = 4; evidenceGroup.add(marks);
      }
    }
    // A branch may call newly acquired observations "iteration" or simply mark
    // them trained; those observations must also remain visible as triangles.
    const newMarks = points.filter(p => p.trained && !['kickstart', 'hybrid', 'active_learning', 'random_exploration'].includes(p.kind));
    if (newMarks.length) evidenceGroup.add(dots(newMarks.map(p => pointPosition(p, 'floor')), { color: INK, size: 9, shape: 'triangle', opacity: .9 }));
    const optimum = points.filter(p => p.predicted_optimum);
    if (optimum.length) {
      const marks = dots(optimum.flatMap(p => [pointPosition(p), pointPosition(p, 'floor')]), {
        color: '#9b303e', size: 10, shape: 'plus', opacity: .9,
      });
      marks.renderOrder = 5; evidenceGroup.add(marks);
    }
  }

  function refreshHighlights() {
    disposeTree(highlightGroup);
    if (!sceneData || !highlightIds.length) return;
    const chosen = highlightIds.map(id => pointMap.get(id)).filter(Boolean);
    const color = highlightKind === 'iteration' ? TEAL : COPPER;
    const many = chosen.length > 120;
    const top = dots(chosen.map(p => pointPosition(p)), { color, size: many ? 4 : 7, opacity: many ? .6 : .95, depthTest: false });
    top.renderOrder = 6; highlightGroup.add(top);
    const bottom = dots(chosen.map(p => pointPosition(p, 'floor')), { color, size: many ? 2.8 : 6, opacity: many ? .42 : .8, shape: many ? 'dot' : 'ring', depthTest: false });
    bottom.renderOrder = 6; highlightGroup.add(bottom);
    if (chosen.length <= 30) {
      const links = lines(chosen.map(p => [pointPosition(p, 'floor'), pointPosition(p)]), { color, opacity: .25, dashed: true, depthTest: false });
      links.renderOrder = 6; highlightGroup.add(links);
    }
  }
  function refreshQuery() {
    disposeTree(queryGroup);
    queryLabel.style.display = 'none';
    breathUniforms.uHasQuery.value = queryPoint && sceneData ? 1 : 0;
    if (!queryPoint || !sceneData) return;
    const top = pointPosition(queryPoint), floor = pointPosition(queryPoint, 'floor');
    breathUniforms.uQueryXZ.value.set(top[0], top[2]);
    if (![...top, ...floor].every(Number.isFinite)) return;
    const glow = dots([top], { color: COPPER, size: 48, opacity: .32, shape: 'glow', depthTest: false });
    const marker = dots([top, floor], { color: COPPER, size: 17, opacity: 1, shape: 'ring', depthTest: false });
    const connector = lines([[floor, top]], { color: COPPER, opacity: .55, dashed: true, depthTest: false });
    glow.renderOrder = 8; connector.renderOrder = 9; marker.renderOrder = 10;
    queryGroup.add(glow, connector, marker);
    const value = Number(queryPoint.prediction_mpa);
    queryLabel.textContent = `${idOf(queryPoint) || 'YOUR COMBINATION'} · ${value.toFixed(2)} MPa`;
    queryLabel.style.display = 'block';
  }

  function project(position) {
    projected.copy(position instanceof THREE.Vector3 ? position : new THREE.Vector3(...position)).project(camera);
    return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2, z: projected.z };
  }
  function updateLabels() {
    for (const label of labels) {
      const screen = project(label.position);
      const visible = screen.z >= -1 && screen.z <= 1 && screen.x > 5 && screen.x < width - 5 && screen.y > 5 && screen.y < height - 5;
      label.element.style.display = visible ? 'block' : 'none';
      label.element.style.left = `${screen.x + label.dx}px`; label.element.style.top = `${screen.y + label.dy}px`;
      label.element.style.transform = `translate(-50%,-50%) rotate(${label.rotate}deg)`;
    }
    if (queryPoint && bounds) {
      const screen = project(pointPosition(queryPoint));
      queryLabel.style.left = `${clamp(screen.x + 15, 10, Math.max(10, width - queryLabel.offsetWidth - 10))}px`;
      queryLabel.style.top = `${clamp(screen.y - 30, 10, height - 35)}px`;
    }
  }
  function hitTest(x, y) {
    if (!sceneData) return null;
    let nearest = null, distance = 105;
    for (const p of sceneData.points) {
      for (const layer of ['floor', 'prediction']) {
        const screen = project(pointPosition(p, layer));
        if (screen.z < -1 || screen.z > 1) continue;
        const d = (screen.x - x) ** 2 + (screen.y - y) ** 2;
        if (d < distance) { distance = d; nearest = p; }
      }
    }
    return nearest;
  }

  function draw(time) {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    // 40 fps keeps a detailed, transparent landscape light on exhibition laptops.
    if (time - lastFrame < 24) return;
    const elapsed = Math.min(80, time - lastFrame);
    lastFrame = time;
    if (morpher && predictionMesh) {
      const fraction = Math.min(1, (time - morpher.started) / morpher.duration), f = ease(fraction);
      const position = predictionMesh.geometry.attributes.position, color = predictionMesh.geometry.attributes.color;
      for (let i = 0; i < position.array.length; i++) position.array[i] = morpher.from[i] * (1 - f) + morpher.to[i] * f;
      for (let i = 0; i < color.array.length; i++) color.array[i] = morpher.fromColor[i] * (1 - f) + morpher.toColor[i] * f;
      position.needsUpdate = true; color.needsUpdate = true;
      if (fraction === 1) { predictionMesh.geometry.computeVertexNormals(); morpher = null; }
    }
    if (predictionMesh) {
      // Actual vertex motion in the GPU shader, not opacity pulsing. Selected
      // points locally pin the skin so their raw numerical markers stay steady.
      const desired = breathing && !morpher ? 1 : 0;
      breathAmount += (desired - breathAmount) * Math.min(1, elapsed / 220);
      breathUniforms.uBreathPhase.value = time / 6800 * TAU;
      breathUniforms.uBreathAmount.value = breathAmount;
    }
    if (pointer && !drag && time - lastHoverTime > 100) {
      hover = hitTest(pointer.x, pointer.y); lastHoverTime = time; pointer = null;
      if (hover) {
        tooltip.textContent = `${idOf(hover)} · ${Number(hover.prediction_mpa).toFixed(2)} MPa`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${clamp(pointerPosition.x + 14, 10, Math.max(10, width - 230))}px`;
        tooltip.style.top = `${clamp(pointerPosition.y + 14, 10, height - 35)}px`;
        canvas.style.cursor = 'pointer';
      } else { tooltip.style.display = 'none'; canvas.style.cursor = 'grab'; }
    }
    updateLabels(); renderer.render(world, camera);
  }

  const pointerPosition = { x: 0, y: 0 };
  function localPointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pointerDown(event) {
    if (event.button !== 0) return;
    const p = localPointer(event);
    drag = { startX: p.x, startY: p.y, x: p.x, y: p.y, distance: 0 };
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
    tooltip.style.display = 'none';
  }
  function pointerMove(event) {
    const p = localPointer(event); Object.assign(pointerPosition, p);
    if (drag) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      drag.distance += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * .0055; elevation = clamp(elevation + dy * .0045, 10 * DEG, 75 * DEG);
      drag.x = p.x; drag.y = p.y; positionCamera();
    } else pointer = p;
  }
  function pointerUp(event) {
    if (!drag) return;
    const clicked = drag.distance < 6, p = localPointer(event); drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
    if (clicked) {
      const point = hitTest(p.x, p.y);
      if (point) { api.setQuery(point); onSelect(point); }
    }
  }
  function pointerLeave() { if (!drag) { tooltip.style.display = 'none'; pointer = null; hover = null; } }
  function wheel(event) { event.preventDefault(); zoom = clamp(zoom * Math.exp(-event.deltaY * .001), .62, 2.4); positionCamera(); }
  function keyDown(event) {
    let handled = true;
    if (event.key === 'ArrowLeft') yaw += .08;
    else if (event.key === 'ArrowRight') yaw -= .08;
    else if (event.key === 'ArrowUp') elevation = clamp(elevation + .06, 10 * DEG, 75 * DEG);
    else if (event.key === 'ArrowDown') elevation = clamp(elevation - .06, 10 * DEG, 75 * DEG);
    else if (event.key === '+' || event.key === '=') zoom = clamp(zoom * 1.1, .62, 2.4);
    else if (event.key === '-') zoom = clamp(zoom / 1.1, .62, 2.4);
    else if (event.key === 'Home' || event.key === '0') api.resetView();
    else if (event.key === 'Enter' && hover) { api.setQuery(hover); onSelect(hover); }
    else handled = false;
    if (handled) { event.preventDefault(); positionCamera(); }
  }
  const handlers = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp,
    pointercancel: pointerUp, pointerleave: pointerLeave, wheel, keydown: keyDown };
  for (const [name, handler] of Object.entries(handlers)) canvas.addEventListener(name, handler, name === 'wheel' ? { passive: false } : undefined);

  const api = {
    /** Keep mesh topology and coordinates fixed for smooth model transitions. */
    setScene(data) {
      if (disposed || !data?.mesh || !data?.points) return;
      const first = !sceneData;
      const sameTopology = predictionMesh && predictionMesh.geometry.attributes.position.count === data.mesh.xy.length;
      sceneData = data; pointMap = new Map(data.points.map(point => [idOf(point), point]));
      if (first) {
        const xx = data.points.map(point => point.UMAP_1), yy = data.points.map(point => point.UMAP_2);
        const xmin = Math.min(...xx), xmax = Math.max(...xx), ymin = Math.min(...yy), ymax = Math.max(...yy);
        mapping = makeDisplayMapping(data.camera.anchor_mpa, data.camera.anchor_display);
        const floor = data.camera.floor_display_z, ceiling = Math.max(...data.camera.anchor_display) + .05;
        bounds = { xmin, xmax, ymin, ymax, floor, ceiling, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2,
          xyScale: 10 / Math.max(xmax - xmin, ymax - ymin), worldHeight: 13, zScale: 13 / (ceiling - floor) };
        elevation = (data.camera.elevation ?? 35.264389682754654) * DEG;
        yaw = (90 + (data.camera.azimuth ?? -45)) * DEG;
        positionCamera(); buildAxes();
      }
      if (sameTopology) {
        const attribute = predictionMesh.geometry.attributes.position, color = predictionMesh.geometry.attributes.color;
        morpher = { from: attribute.array.slice(), to: meshPositions(data, 'prediction_display_z'),
          fromColor: color.array.slice(), toColor: colorsFor(data), started: performance.now(), duration: breathing ? 1600 : 200 };
      } else {
        disposeTree(fixedGroup);
        referenceMesh = buildReference(data); predictionMesh = buildSurface(data);
        fixedGroup.add(referenceMesh, predictionMesh); morpher = null;
      }
      buildEvidence(); refreshHighlights();
      if (queryPoint && pointMap.has(idOf(queryPoint))) queryPoint = pointMap.get(idOf(queryPoint));
      refreshQuery();
    },
    highlight(ids = [], { kind = 'target' } = {}) {
      highlightIds = [...new Set(ids)]; highlightKind = kind; refreshHighlights();
    },
    setQuery(point) { queryPoint = point || null; refreshQuery(); },
    resetView() {
      yaw = (90 + (sceneData?.camera.azimuth ?? -45)) * DEG;
      elevation = (sceneData?.camera.elevation ?? 35.264389682754654) * DEG;
      zoom = 1; positionCamera();
    },
    setBreathing(enabled) { breathing = !!enabled; },
    setReferenceVisible(visible) {
      referenceVisible = !!visible;
      if (referenceMesh) referenceMesh.visible = referenceVisible;
      if (referenceCloud) referenceCloud.visible = referenceVisible;
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect();
      for (const [name, handler] of Object.entries(handlers)) canvas.removeEventListener(name, handler);
      for (const group of [axesGroup, fixedGroup, evidenceGroup, highlightGroup, queryGroup]) disposeTree(group);
      Object.values(textures).forEach(texture => texture.dispose());
      renderer.dispose(); canvas.remove(); overlay.remove();
    },
  };
  frame = requestAnimationFrame(draw);
  return api;
}
