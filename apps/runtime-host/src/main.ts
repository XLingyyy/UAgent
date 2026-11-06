import { RuntimeHostServer } from "./server.js";

const MAX_FRAME_BYTES = 1024 * 1024;
let buffer = Buffer.alloc(0);
let ended = false;
const server = new RuntimeHostServer(message => {
  if (ended) return;
  const line = JSON.stringify(message) + "\n";
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) { fail(); return; }
  process.stdout.write(line);
}, () => {
  ended = true;
  process.stdin.destroy();
  process.stdout.end();
});

function fail(): void {
  if (ended) return;
  ended = true;
  process.exitCode = 1;
  process.stdin.destroy();
  void server.disconnect();
}
process.stdin.on("data", (chunk: Buffer) => {
  if (ended) return;
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf(10);
    if (end < 0) {
      if (buffer.length > MAX_FRAME_BYTES) fail();
      return;
    }
    if (end > MAX_FRAME_BYTES) { fail(); return; }
    const frame = buffer.subarray(0, end);
    buffer = buffer.subarray(end + 1);
    try { void server.receive(JSON.parse(frame.toString("utf8"))).catch(fail); }
    catch { fail(); return; }
  }
});
process.stdin.on("end", () => { ended = true; void server.disconnect(); });
process.stdin.on("error", fail);
process.stdout.on("error", fail);
