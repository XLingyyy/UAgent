import { invalid } from "./utils.js";
export async function* messagesSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  interrupt: Promise<never>,
  maxBytes: number,
): AsyncIterable<{ event?: string; data: unknown }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    event: string | undefined,
    data: string[] = [],
    bytes = 0,
    count = 0;
  const dispatch = () => {
    if (!data.length) {
      event = undefined;
      return;
    }
    if (++count > 20_000) return invalid();
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return invalid();
    }
    const result = { event, data: parsed };
    data = [];
    event = undefined;
    return result;
  };
  while (true) {
    const next = await Promise.race([reader.read(), interrupt]);
    bytes += next.value?.byteLength ?? 0;
    if (bytes > maxBytes) return invalid();
    try {
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
    } catch {
      return invalid();
    }
    while (true) {
      const newline = buffer.search(/[\r\n]/);
      if (newline < 0 || (buffer[newline] === "\r" && newline === buffer.length - 1 && !next.done))
        break;
      const line = buffer.slice(0, newline),
        width = buffer[newline] === "\r" && buffer[newline + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(newline + width);
      if (!line) {
        const value = dispatch();
        if (value) yield value;
        continue;
      }
      if (line[0] === ":") continue;
      const colon = line.indexOf(":"),
        field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value[0] === " ") value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (next.done) {
      if (buffer || data.length) return invalid();
      return;
    }
  }
}
