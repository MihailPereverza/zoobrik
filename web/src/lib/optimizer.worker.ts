import { optimize } from './optimizer';

self.onmessage = (event: MessageEvent<{ lines: string[]; params: number[] | null }>) => {
  try {
    const started = performance.now();
    const result = optimize(event.data.lines, event.data.params);
    self.postMessage({ ok: true, result, ms: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ ok: false, error: String((error as Error)?.message ?? error) });
  }
};
