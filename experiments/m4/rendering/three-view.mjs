import * as T from "three";
import { WIDTH, HEIGHT, palette } from "./scene.mjs";
export async function createView(host) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setClearColor(0x10201e);
  host.append(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-448, 448, 280, -280, 1, 2500);
  const ray = new T.Raycaster(),
    pointer = new T.Vector2();
  let meshes = [],
    carMesh,
    cars = [];
  function setCamera(top = false) {
    camera.position.set(400, top ? 1000 : 720, top ? 250.001 : 250 + 650);
    camera.up.set(0, 1, 0);
    camera.lookAt(400, 0, 250);
    camera.updateMatrixWorld();
  }
  setCamera();
  const material = (color) =>
    new T.MeshBasicMaterial({ color, side: T.DoubleSide });
  function setScene(shapes, vehicles, selected) {
    for (const obj of [...scene.children]) {
      scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    meshes = [];
    cars = vehicles;
    for (const s of shapes) {
      const shape = new T.Shape(s.points.map(([x, y]) => new T.Vector2(x, y)));
      const geo = new T.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2);
      const mesh = new T.Mesh(
        geo,
        material(s.id === selected ? palette.selected : s.color),
      );
      mesh.position.y = s.z;
      mesh.userData.id = s.id;
      mesh.userData.kind = s.kind;
      scene.add(mesh);
      meshes.push(mesh);
      if (s.kind === "bridge") {
        for (const y of [70, 430]) {
          const pier = new T.Mesh(
            new T.BoxGeometry(22, s.z, 10),
            material(0x617785),
          );
          pier.position.set(400, s.z / 2, y);
          pier.userData.id = "bridge";
          scene.add(pier);
          meshes.push(pier);
        }
        const deck = new T.Mesh(
          new T.BoxGeometry(38, 3, 440),
          material(s.id === selected ? palette.selected : s.color),
        );
        deck.position.set(400, s.z - 1.5, 250);
        deck.userData.id = "bridge";
        scene.add(deck);
        meshes.push(deck);
      }
    }
    carMesh = new T.InstancedMesh(
      new T.BoxGeometry(8, 2, 4),
      material(palette.car),
      cars.length,
    );
    const matrix = new T.Matrix4();
    cars.forEach((c, i) => {
      matrix.makeTranslation(c.x, c.z, c.y);
      carMesh.setMatrixAt(i, matrix);
      carMesh.setColorAt(
        i,
        new T.Color(c.id === selected ? palette.selected : palette.car),
      );
    });
    scene.add(carMesh);
    meshes.push(carMesh);
    scene.updateMatrixWorld(true);
  }
  function project([x, y, z = 0]) {
    const p = new T.Vector3(x, z, y).project(camera);
    return [((p.x + 1) * WIDTH) / 2, ((1 - p.y) * HEIGHT) / 2];
  }
  function cast([x, y]) {
    pointer.set((x / WIDTH) * 2 - 1, 1 - (y / HEIGHT) * 2);
    ray.setFromCamera(pointer, camera);
  }
  function unproject(p, z = 0) {
    cast(p);
    const v = new T.Vector3();
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -z), v)
      ? [v.x, v.z]
      : null;
  }
  function pick(p) {
    cast(p);
    const hit = ray
      .intersectObjects(meshes)
      .find((h) => h.object.userData.kind !== "ground");
    return hit
      ? hit.object === carMesh
        ? cars[hit.instanceId].id
        : hit.object.userData.id
      : null;
  }
  return {
    canvas: renderer.domElement,
    setScene,
    setCamera,
    project,
    unproject,
    pick,
    render(time, stress) {
      if (stress) {
        const matrix = new T.Matrix4();
        cars.forEach((c, i) => {
          matrix.makeTranslation(c.x + Math.sin(time / 1000) * 1.5, c.z, c.y);
          carMesh.setMatrixAt(i, matrix);
        });
        carMesh.instanceMatrix.needsUpdate = true;
      }
      renderer.render(scene, camera);
    },
    info() {
      const gl = renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        backend: "Three.js WebGL2",
        gpu: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    },
  };
}
