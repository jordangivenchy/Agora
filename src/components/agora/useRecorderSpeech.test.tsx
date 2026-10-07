// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRecorderSpeech } from "./useRecorderSpeech";

/* The recorder's page noting who is speaking and sending it on. The
   clock is the test's; the network is a stand-in. */
const ROOM = "90dabdf2-c208-46c9-8417-b5070fba44a0";
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const PASS = "1790000000.made-up-signature-for-tests";
const T0 = Date.UTC(2026, 9, 7, 18, 0, 0);

type Props = { pass: string | null; connected: boolean; speaking: string[] };
function Recorder(p: Props) {
  useRecorderSpeech({ roomId: ROOM, pass: p.pass, connected: p.connected, speaking: new Set(p.speaking) });
  return null;
}

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }));
const show = (p: Props) => act(async () => root.render(createElement(Recorder, p)));
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the recorder noting who is speaking", () => {
  it("sends each person's speaking as spans, every ten seconds, with its pass", async () => {
    await show({ pass: PASS, connected: true, speaking: [] });
    await pass(1000);
    await show({ pass: PASS, connected: true, speaking: [ANA] });
    await pass(3000);
    await show({ pass: PASS, connected: true, speaking: [BEN] });
    await pass(2000);
    await show({ pass: PASS, connected: true, speaking: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    await pass(4000); // ten seconds in
    expect(sent()).toEqual([
      {
        url: "/api/internal/recording-speech",
        body: {
          roomId: ROOM,
          key: PASS,
          spans: [
            { id: ANA, s: T0 + 1000, e: T0 + 4000 },
            { id: BEN, s: T0 + 4000, e: T0 + 6000 },
          ],
        },
      },
    ]);
  });

  it("sends nothing while nobody speaks", async () => {
    await show({ pass: PASS, connected: true, speaking: [] });
    await pass(35_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing at all on a page without the pass", async () => {
    await show({ pass: null, connected: true, speaking: [ANA] });
    await pass(25_000);
    await show({ pass: null, connected: true, speaking: [] });
    await pass(25_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops counting someone as speaking when the call drops", async () => {
    await show({ pass: PASS, connected: true, speaking: [ANA] });
    await pass(2000);
    await show({ pass: PASS, connected: false, speaking: [ANA] }); // the list is stale now
    await pass(30_000);
    const spans = sent().flatMap((s) => s.body.spans);
    expect(spans).toEqual([{ id: ANA, s: T0, e: T0 + 2000 }]);
  });

  it("keeps what a failed report couldn't deliver and sends it with the next", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await show({ pass: PASS, connected: true, speaking: [ANA] });
    await pass(2000);
    await show({ pass: PASS, connected: true, speaking: [] });
    await pass(8000); // first report: fails
    await show({ pass: PASS, connected: true, speaking: [BEN] });
    await pass(1000);
    await show({ pass: PASS, connected: true, speaking: [] });
    await pass(9000); // second report
    expect(sent()).toHaveLength(2);
    expect(sent()[1].body.spans).toEqual([
      { id: ANA, s: T0, e: T0 + 2000 },
      { id: BEN, s: T0 + 10_000, e: T0 + 11_000 },
    ]);
  });

  it("doesn't chase a report the server refused", async () => {
    fetchMock.mockResolvedValueOnce({ status: 401 });
    await show({ pass: PASS, connected: true, speaking: [ANA] });
    await pass(2000);
    await show({ pass: PASS, connected: true, speaking: [] });
    await pass(8000);
    await pass(20_000);
    expect(sent()).toHaveLength(1);
  });
});
