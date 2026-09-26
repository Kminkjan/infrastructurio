import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConstructionModel,
  LIMITS,
  snapPoint,
  type Command,
  type Counts,
  type Endpoint,
  type Point,
} from "./model";
import "./style.css";
const model = new ConstructionModel();
const pts = (points: readonly Point[]) =>
  points.map((p) => `${p.x},${-p.y}`).join(" ");
type Tool = "select" | "draw" | "connect" | "section" | "reshape" | "pan";
function App() {
  const [snapshot, setSnapshot] = useState(model.snapshot());
  const [tool, setTool] = useState<Tool>("draw");
  const [counts, setCounts] = useState<Counts>({ forward: 2, backward: 1 });
  const [elevation, setElevation] = useState(0);
  const [selected, setSelected] = useState("");
  const [anchor, setAnchor] = useState<Point>();
  const [cursor, setCursor] = useState<Point>();
  const [endpoint, setEndpoint] = useState<Endpoint>();
  const [sectionStart, setSectionStart] = useState<number>();
  const [command, setCommand] = useState<Command>();
  const [message, setMessage] = useState(
    "Start a road: click its start, then its end. Preview before committing.",
  );
  const [view, setView] = useState({ x: -450, y: -700, width: 1200 });
  const [incoming, setIncoming] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const road = snapshot.authored.roads.find((r) => r.id === selected);
  const pending = useMemo(() => {
    if (!command) return undefined;
    if (
      command.type === "draw" ||
      command.type === "connect" ||
      command.type === "section"
    )
      return { ...command, lanes: counts };
    return command;
  }, [command, counts]);
  const preview = useMemo(
    () => (pending ? model.preview(pending) : undefined),
    [pending, snapshot],
  );
  const shown = preview?.ok ? preview.snapshot : snapshot;
  function cancel() {
    setAnchor(undefined);
    setCursor(undefined);
    setEndpoint(undefined);
    setSectionStart(undefined);
    setCommand(undefined);
  }
  function choose(next: Tool) {
    cancel();
    setTool(next);
    setMessage(
      {
        draw: "Click start and end. Direction snaps to 45°. Use Commit preview to build.",
        connect:
          "Click a round endpoint handle on each of two roads. Both approaches must point into the gap.",
        section:
          "Select a straight road, then click two places on it to bound the widened plateau. Leave taper room on both sides.",
        reshape:
          "Select a straight road, click the endpoint to move, then click its new position.",
        select: "Click a road to select its stable authored identity.",
        pan: "Drag the site to pan. Zoom with the wheel or buttons.",
      }[next],
    );
  }
  function finish(result: ReturnType<typeof model.execute>, text: string) {
    if (result.ok) {
      setSnapshot(result.snapshot);
      setSelected((old) =>
        result.snapshot.authored.roads.some((r) => r.id === old) ? old : "",
      );
      setIncoming((old) =>
        result.snapshot.lanePaths.some((p) => p.laneId === old) ? old : "",
      );
      cancel();
      setMessage(text);
    } else setMessage(result.reasons.map((r) => r.message).join(" "));
  }
  function point(event: React.PointerEvent): Point {
    const matrix = svg.current!.getScreenCTM()!;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x, y: -p.y, z: elevation };
  }
  function aligned(p: Point, a: Point): Point {
    const angle =
      (Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * Math.PI) /
      4;
    const distance = Math.hypot(p.x - a.x, p.y - a.y);
    return snapPoint({
      x: a.x + Math.cos(angle) * distance,
      y: a.y + Math.sin(angle) * distance,
      z: p.z,
    });
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current) {
      const rect = svg.current!.getBoundingClientRect();
      const dx = ((event.clientX - drag.current.x) * view.width) / rect.width,
        dy = ((event.clientY - drag.current.y) * view.width) / rect.width;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      drag.current = { x: event.clientX, y: event.clientY };
      return;
    }
    try {
      const p = anchor
        ? aligned(point(event), anchor)
        : snapPoint(point(event));
      setCursor(p);
      if (tool === "draw" && anchor && !command)
        setMessage(
          `Snapped ${Math.round(Math.hypot(p.x - anchor.x, p.y - anchor.y))} m · 45° increments · click to preview.`,
        );
    } catch {
      setCursor(undefined);
    }
  }
  function siteClick(event: React.PointerEvent<SVGSVGElement>) {
    if (tool === "pan" || event.button === 1) {
      drag.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || command) return;
    try {
      const p = point(event);
      if (tool === "draw") {
        if (!anchor) setAnchor(snapPoint(p));
        else
          setCommand({
            type: "draw",
            start: anchor,
            end: aligned(p, anchor),
            lanes: counts,
          });
      } else if (tool === "reshape" && endpoint && road?.kind === "straight") {
        const other = road[endpoint.end === "start" ? "end" : "start"];
        setCommand({
          type: "reshape",
          roadId: road.id,
          start: endpoint.end === "start" ? aligned(p, other) : road.start,
          end: endpoint.end === "end" ? aligned(p, other) : road.end,
        });
      }
    } catch {
      setMessage("Keep construction inside the ±2000 m site.");
    }
  }
  function clickRoad(event: React.PointerEvent, id: string) {
    if (tool === "draw" || tool === "pan" || (tool === "reshape" && endpoint))
      return;
    event.stopPropagation();
    setSelected(id);
    if (tool !== "section" || command) return;
    const r = snapshot.authored.roads.find((r) => r.id === id)!;
    if (r.kind !== "straight") {
      setMessage("Select a straight approach for widening.");
      return;
    }
    const p = point(event),
      dx = r.end.x - r.start.x,
      dy = r.end.y - r.start.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        Math.round(
          (((p.x - r.start.x) * dx + (p.y - r.start.y) * dy) /
            (dx * dx + dy * dy)) *
            100,
        ) / 100,
      ),
    );
    if (sectionStart === undefined || selected !== id) {
      setSectionStart(t);
      setMessage("Start boundary marked. Click the end boundary on this road.");
    } else {
      setCommand({
        type: "section",
        roadId: id,
        start: Math.min(t, sectionStart),
        end: Math.max(t, sectionStart),
        lanes: counts,
      });
    }
  }
  function clickEnd(event: React.SyntheticEvent, ref: Endpoint) {
    if (tool === "select") {
      event.stopPropagation();
      setSelected(ref.roadId);
      return;
    }
    if (tool !== "connect" && tool !== "reshape") return;
    event.stopPropagation();
    if (command) return;
    setSelected(ref.roadId);
    if (tool === "reshape") {
      setEndpoint(ref);
      setMessage(`Move ${ref.end}: click a new snapped position.`);
      return;
    }
    if (!endpoint) {
      setEndpoint(ref);
      setMessage("First endpoint selected. Click the other approach endpoint.");
    } else
      setCommand({ type: "connect", from: endpoint, to: ref, lanes: counts });
  }
  const zoom = (factor: number) =>
    setView((v) => {
      const width = Math.max(200, Math.min(4000, v.width * factor));
      return {
        ...v,
        x: v.x + (v.width - width) / 2,
        y: v.y + (v.width - width) / 3,
        width,
      };
    });
  const laneOptions = snapshot.lanePaths.filter((p) => p.roadId === selected);
  const candidates = snapshot.candidates.filter(
    (m) => m.fromLaneId === incoming,
  );
  const legalTargets = snapshot.movements
    .filter((m) => m.fromLaneId === incoming)
    .map((m) => m.toLaneId);
  const laneName = (id: string) => {
    for (const r of snapshot.authored.roads) {
      const l = [...r.lanes, ...r.sections.flatMap((s) => s.lanes)].find(
        (l) => l.id === id,
      );
      if (l) return `${r.id} · ${l.direction} ${l.index + 1}`;
    }
    return id;
  };
  const grid = [];
  for (let x = Math.floor(view.x / 10) * 10; x < view.x + view.width; x += 10)
    grid.push(
      <line
        key={"x" + x}
        x1={x}
        x2={x}
        y1={view.y}
        y2={view.y + view.width}
        className={x % 100 === 0 ? "major" : "minor"}
      />,
    );
  for (let y = Math.floor(view.y / 10) * 10; y < view.y + view.width; y += 10)
    grid.push(
      <line
        key={"y" + y}
        y1={y}
        y2={y}
        x1={view.x}
        x2={view.x + view.width}
        className={y % 100 === 0 ? "major" : "minor"}
      />,
    );
  return (
    <main
      onKeyDown={(e) => {
        const editing = ["INPUT", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        );
        if (e.key === "Escape") {
          cancel();
          setMessage("Preview cancelled.");
        }
        if (!editing && (e.ctrlKey || e.metaKey) && e.key === "z") {
          e.preventDefault();
          finish(model.undo(), "Undid one authored edit.");
        }
      }}
    >
      <header>
        <div>
          <small>INFRASTRUCTURIO / M4 EXPERIMENT</small>
          <h1>Construction lab</h1>
        </div>
        <p>
          Design roads, fit curves, refine lanes.
          <br />
          10 m grid · metres · plan view
        </p>
      </header>
      <nav aria-label="Construction tools">
        {(
          ["draw", "connect", "select", "reshape", "section", "pan"] as Tool[]
        ).map((t) => (
          <button key={t} aria-pressed={tool === t} onClick={() => choose(t)}>
            {
              {
                draw: "Draw road",
                connect: "Connect endpoints",
                select: "Select",
                reshape: "Reshape",
                section: "Widen section",
                pan: "Pan",
              }[t]
            }
          </button>
        ))}
        <button
          onClick={() => finish(model.undo(), "Undid one authored edit.")}
        >
          Undo
        </button>
        <button
          onClick={() => {
            cancel();
            setMessage("Preview cancelled.");
          }}
        >
          Cancel / Esc
        </button>
      </nav>
      <div className="workspace">
        <aside>
          <h2>Road settings</h2>
          <label>
            Preset
            <select
              onChange={(e) =>
                setCounts(
                  e.target.value === "avenue"
                    ? { forward: 2, backward: 1 }
                    : e.target.value === "oneway"
                      ? { forward: 2, backward: 0 }
                      : { forward: 1, backward: 1 },
                )
              }
              defaultValue="avenue"
            >
              <option value="avenue">Avenue · 2 + 1</option>
              <option value="street">Street · 1 + 1</option>
              <option value="oneway">One way · 2 + 0</option>
            </select>
          </label>
          {(["forward", "backward"] as const).map((d) => (
            <label key={d}>
              {d === "forward" ? "Forward lanes →" : "Backward lanes ←"}
              <select
                value={counts[d]}
                onChange={(e) =>
                  setCounts({ ...counts, [d]: Number(e.target.value) })
                }
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Construction elevation
            <select
              value={elevation}
              onChange={(e) => setElevation(Number(e.target.value))}
            >
              {[0, 6, 10, -6].map((z) => (
                <option key={z} value={z}>
                  {z} m{z === 0 ? " · ground" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Counts follow start → end. For a crossing, draw at +6 m across an
            existing ground road. Crossings do not connect.
          </p>
          <h2>Preview</h2>
          <div
            role="status"
            className={preview && !preview.ok ? "feedback error" : "feedback"}
          >
            {preview
              ? preview.ok
                ? `Valid ${pending?.type}. Affects ${preview.affectedRoadIds.length} road(s).`
                : preview.reasons.map((r) => r.message).join(" ")
              : message}
          </div>
          <button
            className="primary"
            disabled={!preview?.ok}
            onClick={() =>
              pending &&
              finish(
                model.execute(pending),
                "Edit committed. Continue building or Undo to restore it.",
              )
            }
          >
            Commit preview
          </button>
          <h2>Selection</h2>
          <p>{road ? `${road.id} · ${road.kind}` : "No road selected"}</p>
          <button
            disabled={!road}
            onClick={() =>
              road && setCommand({ type: "remove", roadId: road.id })
            }
          >
            Preview delete
          </button>
          {road?.sections.map((s) => (
            <div key={s.id} className="section-row">
              Plateau {Math.round(s.start * 100)}–{Math.round(s.end * 100)}%
              <button
                onClick={() =>
                  setCommand({
                    type: "remove-section",
                    roadId: road.id,
                    sectionId: s.id,
                  })
                }
              >
                Remove section
              </button>
            </div>
          ))}
          <h2>Lane connections</h2>
          <label>
            Incoming lane
            <select
              value={incoming}
              onChange={(e) => {
                cancel();
                setIncoming(e.target.value);
              }}
            >
              <option value="">Select a lane</option>
              {laneOptions.map((p) => (
                <option key={p.laneId} value={p.laneId}>
                  {laneName(p.laneId)}
                </option>
              ))}
            </select>
          </label>
          {incoming && (
            <>
              <p className="hint">
                Checked targets are legal. Each change is one undoable edit.
                Taper lanes default to the outer continuing lane. Inner targets
                appear only with enough plateau space (15 m per metre of lateral
                change).
              </p>
              {candidates.length ? (
                candidates.map((c) => (
                  <label className="target" key={c.id}>
                    <input
                      type="checkbox"
                      checked={legalTargets.includes(c.toLaneId)}
                      onChange={(e) =>
                        finish(
                          model.execute({
                            type: "assign",
                            fromLaneId: incoming,
                            toLaneIds: e.target.checked
                              ? [...legalTargets, c.toLaneId]
                              : legalTargets.filter((id) => id !== c.toLaneId),
                          }),
                          "Lane assignment committed.",
                        )
                      }
                    />
                    {laneName(c.toLaneId)}
                  </label>
                ))
              ) : (
                <p>No compatible outgoing targets at this lane end.</p>
              )}
              <button
                onClick={() =>
                  finish(
                    model.execute({
                      type: "assign",
                      fromLaneId: incoming,
                      toLaneIds: null,
                    }),
                    "Automatic defaults restored.",
                  )
                }
              >
                Restore defaults
              </button>
            </>
          )}
        </aside>
        <section className="site">
          <div className="view-tools">
            <button onClick={() => zoom(0.8)} aria-label="Zoom in">
              +
            </button>
            <button onClick={() => zoom(1.25)} aria-label="Zoom out">
              −
            </button>
            <button onClick={() => setView({ x: -450, y: -700, width: 1200 })}>
              Reset view
            </button>
            <span>
              {snapshot.authored.roads.length} roads ·{" "}
              {snapshot.movements.length} legal connections
            </span>
          </div>
          <svg
            ref={svg}
            viewBox={`${view.x} ${view.y} ${view.width} ${(view.width * 2) / 3}`}
            role="img"
            aria-label="Construction site with 10 metre grid"
            tabIndex={0}
            onPointerDown={siteClick}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onWheel={(e) => zoom(e.deltaY > 0 ? 1.1 : 0.9)}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#9cc9cf" />
              </marker>
            </defs>
            {grid}
            {shown.geometry.map((g) => (
              <g key={g.roadId} onPointerDown={(e) => clickRoad(e, g.roadId)}>
                <polygon
                  points={pts([
                    ...g.edges.map((e) => e.left),
                    ...g.edges.map((e) => e.right).reverse(),
                  ])}
                  fill={g.controls[0].z !== 0 ? "#5b607e" : "#344752"}
                  stroke={selected === g.roadId ? "#ffd166" : "#78909a"}
                  strokeWidth={selected === g.roadId ? 2 : 1}
                />
                <polyline
                  points={pts(g.centerline)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(g.width, 12)}
                />
                <text
                  x={g.centerline[32].x}
                  y={-g.centerline[32].y - 15}
                  className="road-label"
                >
                  {g.roadId} · {g.controls[0].z} m
                </text>
              </g>
            ))}
            {shown.lanePaths.map((p) => (
              <polyline
                pointerEvents="none"
                key={p.laneId}
                points={pts(p.points)}
                fill="none"
                stroke={incoming === p.laneId ? "#ffdb72" : "#9cc9cf"}
                strokeWidth={incoming === p.laneId ? 2 : 0.7}
                markerEnd="url(#arrow)"
              />
            ))}
            {shown.movements
              .filter((m) => m.fromLaneId === incoming)
              .map((m) => (
                <g key={m.id} pointerEvents="none">
                  <polyline
                    points={pts(m.points)}
                    fill="none"
                    stroke="#f2a2ff"
                    strokeWidth="3"
                  />
                  <circle
                    cx={m.points[0].x}
                    cy={-m.points[0].y}
                    r="4"
                    fill="#f2a2ff"
                  />
                </g>
              ))}
            {shown.authored.roads
              .filter((r) => r.kind === "straight")
              .map(
                (r) =>
                  r.kind === "straight" && (
                    <g key={r.id}>
                      {(["start", "end"] as const).map((end) => (
                        <g
                          key={end}
                          pointerEvents={
                            tool === "connect" ||
                            tool === "reshape" ||
                            tool === "select"
                              ? "auto"
                              : "none"
                          }
                          role="button"
                          aria-label={`${r.id} ${end}`}
                          tabIndex={
                            tool === "connect" ||
                            tool === "reshape" ||
                            tool === "select"
                              ? 0
                              : -1
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              clickEnd(e, { roadId: r.id, end });
                            }
                          }}
                          onPointerDown={(e) =>
                            clickEnd(e, { roadId: r.id, end })
                          }
                        >
                          <circle
                            cx={r[end].x}
                            cy={-r[end].y}
                            r={6}
                            fill={
                              endpoint?.roadId === r.id && endpoint.end === end
                                ? "#ffdb72"
                                : "#e6f4f1"
                            }
                            stroke="#263e46"
                          />
                          <circle
                            cx={r[end].x}
                            cy={-r[end].y}
                            r={6}
                            fill="transparent"
                            stroke="transparent"
                            strokeWidth={16}
                            vectorEffect="non-scaling-stroke"
                          />
                          <title>
                            {r.id} {end}
                          </title>
                        </g>
                      ))}
                      {r.sections.flatMap((s) =>
                        [s.taperStart, s.start, s.end, s.taperEnd].map(
                          (t, i) => (
                            <circle
                              key={s.id + i}
                              pointerEvents="none"
                              cx={r.start.x + (r.end.x - r.start.x) * t}
                              cy={-(r.start.y + (r.end.y - r.start.y) * t)}
                              r={i === 1 || i === 2 ? 5 : 3}
                              fill={i === 1 || i === 2 ? "#ffdb72" : "#f2a2ff"}
                            />
                          ),
                        ),
                      )}
                    </g>
                  ),
              )}
            {sectionStart !== undefined && road?.kind === "straight" && (
              <circle
                cx={road.start.x + (road.end.x - road.start.x) * sectionStart}
                cy={
                  -(road.start.y + (road.end.y - road.start.y) * sectionStart)
                }
                r="7"
                fill="#ffdb72"
              />
            )}
            {anchor && cursor && !command && (
              <line
                x1={anchor.x}
                y1={-anchor.y}
                x2={cursor.x}
                y2={-cursor.y}
                stroke="#ffd166"
                strokeWidth="2"
                strokeDasharray="5 5"
              />
            )}
            {pending?.type === "draw" && !preview?.ok && (
              <line
                x1={pending.start.x}
                y1={-pending.start.y}
                x2={pending.end.x}
                y2={-pending.end.y}
                stroke="#ff7f7f"
                strokeWidth="3"
              />
            )}
            {cursor && tool === "draw" && !command && (
              <circle cx={cursor.x} cy={-cursor.y} r="3" fill="#ffd166" />
            )}
          </svg>
          <footer>
            <span>Minor grid {LIMITS.grid} m · major grid 100 m</span>
            <span>
              Yellow: selection / plateau · pink: taper / lane connection
            </span>
          </footer>
          <div className="guide">
            <b>Try a curved connection</b>
            <p>
              Draw an eastbound approach, then a northbound approach above and
              to its right. Leave at least 130 m in both directions for the
              default lanes; 400 m gives editing room. Connect the first road’s
              end to the second road’s start. To widen, choose 3 forward lanes,
              then mark a middle stretch with at least 35 m spare on each side.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
