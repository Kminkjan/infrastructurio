import {
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { axial, toWorld } from "../core/lattice";
import { palette } from "../render/art/palette";
import { simToWorld } from "../render/coords";

// Skeleton smoke scene: isometric orthographic view of the lattice on grass.
// Slice D1 replaces this with the real camera controller, terrain and scheduler.

const ISO_PITCH = Math.atan(1 / Math.SQRT2); // 35.264°, true isometric
const PIXELS_PER_METRE = 6; // "Default" zoom level
const CAMERA_DISTANCE = 2000;
const LATTICE_RADIUS_M = 160;

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const viewport = document.querySelector<HTMLDivElement>("#viewport");
if (!canvas || !viewport) throw new Error("missing #world canvas or #viewport");

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = NeutralToneMapping;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new Scene();
scene.background = new Color(palette.haze);
scene.add(new HemisphereLight(palette.sky, palette.groundBounce, 1.1));
const SUN_ELEVATION = (42 * Math.PI) / 180;
const sun = new DirectionalLight(palette.sun, 2.4);
// Upper-left of the screen at k = 0: normalise the horizontal part first so the
// elevation is exactly 42° (normalising the full vector after would change it).
const sunHorizontal = new Vector3(-0.55, 0, 0.45).normalize().multiplyScalar(Math.cos(SUN_ELEVATION));
sun.position.set(sunHorizontal.x, Math.sin(SUN_ELEVATION), sunHorizontal.z);
scene.add(sun);

const ground = new Mesh(
  new PlaneGeometry(LATTICE_RADIUS_M * 2.6, LATTICE_RADIUS_M * 2.6).rotateX(-Math.PI / 2),
  new MeshLambertMaterial({ color: palette.grass }),
);
scene.add(ground);

const nodes: Vector3[] = [];
for (let q = -48; q <= 48; q++) {
  for (let r = -48; r <= 48; r++) {
    const w = toWorld(axial(q, r));
    if (Math.hypot(w.x, w.y) <= LATTICE_RADIUS_M) nodes.push(simToWorld(w.x, w.y, 0.02));
  }
}
const dots = new InstancedMesh(
  new CircleGeometry(0.22, 8).rotateX(-Math.PI / 2),
  new MeshBasicMaterial({ color: palette.latticeLine }),
  nodes.length,
);
const m = new Matrix4();
nodes.forEach((p, i) => dots.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
scene.add(dots);

const camera = new OrthographicCamera(-1, 1, 1, -1, 10, 4000);
camera.position.set(0, Math.sin(ISO_PITCH), Math.cos(ISO_PITCH)).multiplyScalar(CAMERA_DISTANCE);
camera.lookAt(0, 0, 0);

function resize(): void {
  const width = viewport!.clientWidth;
  const height = viewport!.clientHeight;
  renderer.setSize(width, height, false);
  const halfW = width / (2 * PIXELS_PER_METRE);
  const halfH = height / (2 * PIXELS_PER_METRE);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

new ResizeObserver(resize).observe(viewport);
resize();
