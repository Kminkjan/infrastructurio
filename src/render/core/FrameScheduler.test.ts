import { describe, expect, it } from "vitest";
import { type FrameInfo, FrameScheduler, type SchedulerHost } from "./FrameScheduler";

/** A fake display: rAF callbacks queue until `vsync` runs them at a given time. */
class FakeHost implements SchedulerHost {
  time = 0;
  hidden = false;
  private nextHandle = 1;
  readonly queue = new Map<number, (time: number) => void>();

  requestAnimationFrame(callback: (time: number) => void): number {
    const handle = this.nextHandle++;
    this.queue.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.queue.delete(handle);
  }

  now(): number {
    return this.time;
  }

  isHidden(): boolean {
    return this.hidden;
  }

  /** Advances time by one display refresh and runs whatever was queued. */
  vsync(intervalMs = 1000 / 60): void {
    this.time += intervalMs;
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const cb of callbacks) cb(this.time);
  }

  run(frames: number, intervalMs?: number): void {
    for (let i = 0; i < frames; i++) this.vsync(intervalMs);
  }
}

function setup(): { host: FakeHost; scheduler: FrameScheduler; frames: FrameInfo[] } {
  const host = new FakeHost();
  const scheduler = new FrameScheduler(host);
  const frames: FrameInfo[] = [];
  scheduler.onFrame((f) => frames.push({ ...f }));
  return { host, scheduler, frames };
}

describe("frame scheduler", () => {
  it("renders zero frames and queues nothing while idle", () => {
    const { host, scheduler } = setup();
    host.run(120);
    expect(scheduler.frameCount).toBe(0);
    expect(host.queue.size).toBe(0);
  });

  it("renders one frame per request, coalescing requests made before it runs", () => {
    const { host, scheduler, frames } = setup();
    scheduler.requestFrame("input");
    scheduler.requestFrame("hover");
    scheduler.requestFrame("resize");
    expect(host.queue.size).toBe(1);
    host.run(10);
    expect(scheduler.frameCount).toBe(1);
    scheduler.requestFrame("input");
    host.run(10);
    expect(scheduler.frameCount).toBe(2);
    expect(frames.map((f) => f.consecutive)).toEqual([false, false]);
  });

  it("keeps looping while a continuous reason is active and stops when it clears", () => {
    const { host, scheduler, frames } = setup();
    scheduler.setContinuous("camera-anim", true);
    host.run(30);
    expect(scheduler.frameCount).toBe(30);
    expect(frames.slice(1).every((f) => f.consecutive)).toBe(true);
    expect(frames[1]?.dtMs).toBeCloseTo(1000 / 60, 9);
    scheduler.setContinuous("camera-anim", false);
    host.run(30);
    expect(scheduler.frameCount).toBe(30);
    expect(host.queue.size).toBe(0);
  });

  it("chains the next frame when a listener requests one during a frame", () => {
    const { host, scheduler } = setup();
    let remaining = 3;
    scheduler.onFrame(() => {
      if (remaining-- > 0) scheduler.requestFrame("overlay");
    });
    scheduler.requestFrame("init");
    host.run(20);
    expect(scheduler.frameCount).toBe(4);
  });

  it("lets a listener switch its own continuous reason off during the frame", () => {
    const { host, scheduler } = setup();
    let left = 5;
    scheduler.onFrame(() => scheduler.setContinuous("camera-anim", --left > 0));
    scheduler.setContinuous("camera-anim", true);
    host.run(20);
    expect(scheduler.frameCount).toBe(5);
  });

  it("throttles ambient alone to 30 fps on 60, 120 and 144 Hz displays", () => {
    for (const hz of [60, 120, 144]) {
      const { host, scheduler } = setup();
      scheduler.setContinuous("ambient", true);
      host.run(hz * 2, 1000 / hz);
      const fps = scheduler.frameCount / 2;
      expect(fps).toBeLessThanOrEqual(30.5);
      expect(fps).toBeGreaterThanOrEqual(24);
    }
  });

  it("drops the ambient throttle while another reason is active", () => {
    const { host, scheduler } = setup();
    scheduler.setContinuous("ambient", true);
    scheduler.setContinuous("sim-running", true);
    host.run(60);
    expect(scheduler.frameCount).toBe(60);
  });

  it("stops the loop while hidden and resumes when visible", () => {
    const { host, scheduler, frames } = setup();
    scheduler.setContinuous("sim-running", true);
    host.run(10);
    host.hidden = true;
    scheduler.handleVisibilityChange();
    expect(host.queue.size).toBe(0);
    host.run(100);
    expect(scheduler.frameCount).toBe(10);
    scheduler.requestFrame("input");
    expect(host.queue.size).toBe(0);
    host.hidden = false;
    scheduler.handleVisibilityChange();
    host.run(5);
    expect(scheduler.frameCount).toBe(15);
    // The first frame after the page returns is not treated as a normal step.
    expect(frames[10]?.consecutive).toBe(false);
  });

  it("stops by itself if the page is hidden before the visibility event arrives", () => {
    const { host, scheduler } = setup();
    scheduler.setContinuous("sim-running", true);
    host.run(3);
    host.hidden = true;
    host.run(10);
    expect(scheduler.frameCount).toBe(3);
    expect(host.queue.size).toBe(0);
  });

  it("goes quiet after dispose", () => {
    const { host, scheduler } = setup();
    scheduler.setContinuous("camera-anim", true);
    host.run(2);
    scheduler.dispose();
    scheduler.requestFrame("input");
    host.run(10);
    expect(scheduler.frameCount).toBe(2);
    expect(host.queue.size).toBe(0);
  });
});
