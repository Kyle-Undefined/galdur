const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "node-pty",
  "lib",
  "windowsConoutConnection.js"
);

if (!fs.existsSync(target)) {
  console.warn(`[galdur] node-pty patch skipped, file missing: ${target}`);
  process.exit(0);
}

const patched = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConoutConnection = void 0;
const conout_1 = require("./shared/conout");
const path_1 = require("path");
const eventEmitter2_1 = require("./eventEmitter2");
let workerThreads = null;
try {
  workerThreads = require("worker_threads");
} catch {
  workerThreads = null;
}
const FLUSH_DATA_INTERVAL = 1000;
class ConoutConnection {
  constructor(conoutPipeName, useConptyDll) {
    this._conoutPipeName = conoutPipeName;
    this._useConptyDll = useConptyDll;
    this._isDisposed = false;
    this._onReady = new eventEmitter2_1.EventEmitter2();
    this._worker = null;
    this._drainTimeout = undefined;
    this._directMode = false;
    const workerData = { conoutPipeName };
    if (workerThreads && typeof workerThreads.Worker === "function") {
      try {
        const scriptPath = __dirname.replace(
          "node_modules.asar",
          "node_modules.asar.unpacked"
        );
        this._worker = new workerThreads.Worker(
          (0, path_1.join)(scriptPath, "worker/conoutSocketWorker.js"),
          { workerData }
        );
        this._worker.on("message", (message) => {
          if (message === 1) {
            this._onReady.fire();
            return;
          }
          console.warn("Unexpected ConoutWorkerMessage", message);
        });
        return;
      } catch (error) {
        console.warn(
          "[galdur] Worker unsupported for node-pty; using direct conout socket:",
          String(error)
        );
      }
    }
    this._directMode = true;
    setTimeout(() => this._onReady.fire(), 0);
  }
  get onReady() {
    return this._onReady.event;
  }
  dispose() {
    if (!this._useConptyDll && this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._drainDataAndClose();
  }
  connectSocket(socket) {
    if (this._directMode) {
      socket.connect(this._conoutPipeName);
      return;
    }
    socket.connect((0, conout_1.getWorkerPipeName)(this._conoutPipeName));
  }
  _drainDataAndClose() {
    if (this._drainTimeout) {
      clearTimeout(this._drainTimeout);
    }
    this._drainTimeout = setTimeout(
      () => this._destroySocket(),
      FLUSH_DATA_INTERVAL
    );
  }
  _destroySocket() {
    if (!this._worker) {
      return;
    }
    void this._worker.terminate();
  }
}
exports.ConoutConnection = ConoutConnection;
`;

fs.writeFileSync(target, patched, "utf8");
console.log(`[galdur] Patched node-pty Worker fallback at ${target}`);
