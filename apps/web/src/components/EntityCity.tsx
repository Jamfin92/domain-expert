import { useLayoutEffect, useRef, useState } from "react";
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Layout3D } from "@/lib/api";
import { hasWebGL } from "@/lib/webgl";
import {
  CAMERA_FOV,
  PALETTE,
  buildingBox,
  districtPlate,
  edgeSegments,
  frameCamera,
  sceneBounds,
  type EdgeSegment,
} from "@/lib/scene3d";

/**
 * The 3D entity city: a static three.js rendering of a server-computed
 * `Layout3D`. Districts are thin ground slabs, entities are buildings, FK
 * edges run above the rooftops with a cone at the dependent end.
 *
 * Static means static: the scene renders on mount, on resize and on layout
 * change — no animation loop. Camera controls and picking land in a later
 * phase; this component's whole job is to draw the city and clean up after
 * itself completely on unmount.
 */

interface Props {
  layout: Layout3D;
  fallback: React.ReactNode;
}

/** Anything with a `dispose()` — geometries, materials, the render target set. */
interface Disposable {
  dispose(): void;
}

const UP = new Vector3(0, 1, 0);
const CONE_LEN = 2;
const CONE_RADIUS = 0.7;

/**
 * One merged position buffer for a batch of edges. A single draw call per
 * style beats one object per edge, and disposal stays a two-entry affair.
 *
 * For dashed lines the `lineDistance` attribute is built by hand as
 * `[0, len]` per vertex pair. `computeLineDistances()` accumulates distance
 * cumulatively across the whole buffer, so later segments would start at an
 * arbitrary dash phase and short ones could land wholly inside a gap.
 */
function edgeGeometry(segs: EdgeSegment[], dashed: boolean): BufferGeometry {
  const pos = new Float32Array(segs.length * 6);
  const dist = dashed ? new Float32Array(segs.length * 2) : null;
  segs.forEach((s, i) => {
    pos.set([s.from.x, s.from.y, s.from.z, s.to.x, s.to.y, s.to.z], i * 6);
    if (dist) {
      const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z);
      dist[i * 2] = 0;
      dist[i * 2 + 1] = len;
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  if (dist) geo.setAttribute("lineDistance", new BufferAttribute(dist, 1));
  return geo;
}

export function EntityCity({ layout, fallback }: Props): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Lazy initialiser: probe once, not on every render.
  const [webglOk, setWebglOk] = useState(() => hasWebGL());

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!webglOk || !el) return;

    let renderer: WebGLRenderer;
    try {
      // Guard two of two: the probe can pass while construction still throws.
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setWebglOk(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Transparent clear: the card background shows through.
    renderer.setClearColor(0x000000, 0);
    // Block display: an inline canvas gets a baseline gap under it.
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const disposables = new Set<Disposable>();
    const track = <T extends Disposable>(d: T): T => {
      disposables.add(d);
      return d;
    };

    const scene = new Scene();

    // Lambert is a lit material: without lights every building is pure black.
    const ambient = track(new AmbientLight(PALETTE.ambient, 0.75));
    const directional = track(new DirectionalLight(PALETTE.directional, 1.1));
    directional.position.set(1, 2, 1.5);
    scene.add(ambient, directional);

    // One unit box, scaled per mesh, shared by every plate and building.
    const unitBox = track(new BoxGeometry(1, 1, 1));
    const unitBoxEdges = track(new EdgesGeometry(unitBox));
    const buildingMat = track(new MeshLambertMaterial({ color: PALETTE.building }));
    const plateMat = track(new MeshLambertMaterial({ color: PALETTE.plate }));
    const buildingEdgeMat = track(new LineBasicMaterial({ color: PALETTE.buildingEdge }));

    for (const d of layout.districts) {
      const p = districtPlate(d);
      const mesh = new Mesh(unitBox, plateMat);
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.set(p.width, p.height, p.depth);
      scene.add(mesh);
    }

    for (const n of layout.nodes) {
      const b = buildingBox(n);
      const mesh = new Mesh(unitBox, buildingMat);
      mesh.position.set(b.x, b.y, b.z);
      mesh.scale.set(b.width, b.height, b.depth);
      scene.add(mesh);
      const outline = new LineSegments(unitBoxEdges, buildingEdgeMat);
      outline.position.copy(mesh.position);
      outline.scale.copy(mesh.scale);
      scene.add(outline);
    }

    const segs = edgeSegments(layout);
    const solid = segs.filter((s) => !s.inferred);
    const inferred = segs.filter((s) => s.inferred);
    if (solid.length > 0) {
      const mat = track(new LineBasicMaterial({ color: PALETTE.edge }));
      scene.add(new LineSegments(track(edgeGeometry(solid, false)), mat));
    }
    if (inferred.length > 0) {
      const mat = track(
        new LineDashedMaterial({ color: PALETTE.edgeInferred, dashSize: 1.5, gapSize: 1 }),
      );
      scene.add(new LineSegments(track(edgeGeometry(inferred, true)), mat));
    }

    // Direction cones at the `to` (dependent) end. from = principal,
    // to = dependent — that is the layout's contract, not a bug.
    if (segs.length > 0) {
      const coneGeo = track(new ConeGeometry(CONE_RADIUS, CONE_LEN, 8));
      const coneMat = track(new MeshLambertMaterial({ color: PALETTE.edge }));
      const coneMatInferred = track(new MeshLambertMaterial({ color: PALETTE.edgeInferred }));
      for (const s of segs) {
        const dir = new Vector3(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z).normalize();
        const cone = new Mesh(coneGeo, s.inferred ? coneMatInferred : coneMat);
        cone.quaternion.setFromUnitVectors(UP, dir);
        // Cone centre pulled back half its length, tip touching the endpoint.
        cone.position.set(
          s.to.x - dir.x * (CONE_LEN / 2),
          s.to.y - dir.y * (CONE_LEN / 2),
          s.to.z - dir.z * (CONE_LEN / 2),
        );
        scene.add(cone);
      }
    }

    const bounds = sceneBounds(layout);
    const maxHeight = layout.nodes.reduce((m, n) => Math.max(m, n.height), 0);
    const framing = frameCamera(bounds, maxHeight);
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, framing.near, framing.far);
    camera.position.set(framing.position.x, framing.position.y, framing.position.z);
    camera.lookAt(framing.target.x, framing.target.y, framing.target.z);

    // Render on demand: mount, resize, layout change. No RAF loop.
    const render = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      // Let three set canvas.style too: without it the canvas lays out at
      // its attribute size (container × pixelRatio) and overflows the card.
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    render();

    const ro = new ResizeObserver(render);
    ro.observe(el);

    return () => {
      ro.disconnect();
      for (const d of disposables) d.dispose();
      // three's documented teardown order: lose the context, then dispose.
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [layout, webglOk]);

  if (!webglOk) {
    return <div data-psq="city-fallback">{fallback}</div>;
  }
  return <div ref={boxRef} data-psq="city" className="h-full w-full overflow-hidden" />;
}
