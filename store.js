import fs from "node:fs";
import path from "node:path";

export class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]");
    }
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return [];
    }
  }

  saveSignal(signal) {
    if (!signal || signal.action !== "BUY_POSSIBLE") return;

    const items = this.read();
    const minute = Math.floor(Date.parse(signal.observedAt) / 60000);
    const key = `${signal.mint}:${minute}`;

    if (items.some(x => x.key === key)) return;

    items.push({
      key,
      ...signal
    });

    fs.writeFileSync(
      this.file,
      JSON.stringify(items.slice(-5000), null, 2)
    );
  }

  signals(n = 100) {
    return this.read().slice(-n).reverse();
  }
}
