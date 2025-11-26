var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
var init_utils = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/_internal/utils.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    __name(createNotImplementedError, "createNotImplementedError");
    __name(notImplemented, "notImplemented");
    __name(notImplementedClass, "notImplementedClass");
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin, _performanceNow, nodeTiming, PerformanceEntry, PerformanceMark, PerformanceMeasure, PerformanceResourceTiming, PerformanceObserverEntryList, Performance, PerformanceObserver, performance2;
var init_performance = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_utils();
    _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
    _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
    nodeTiming = {
      name: "node",
      entryType: "node",
      startTime: 0,
      duration: 0,
      nodeStart: 0,
      v8Start: 0,
      bootstrapComplete: 0,
      environment: 0,
      loopStart: 0,
      loopExit: 0,
      idleTime: 0,
      uvMetricsInfo: {
        loopCount: 0,
        events: 0,
        eventsWaiting: 0
      },
      detail: void 0,
      toJSON() {
        return this;
      }
    };
    PerformanceEntry = class {
      static {
        __name(this, "PerformanceEntry");
      }
      __unenv__ = true;
      detail;
      entryType = "event";
      name;
      startTime;
      constructor(name, options) {
        this.name = name;
        this.startTime = options?.startTime || _performanceNow();
        this.detail = options?.detail;
      }
      get duration() {
        return _performanceNow() - this.startTime;
      }
      toJSON() {
        return {
          name: this.name,
          entryType: this.entryType,
          startTime: this.startTime,
          duration: this.duration,
          detail: this.detail
        };
      }
    };
    PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
      static {
        __name(this, "PerformanceMark");
      }
      entryType = "mark";
      constructor() {
        super(...arguments);
      }
      get duration() {
        return 0;
      }
    };
    PerformanceMeasure = class extends PerformanceEntry {
      static {
        __name(this, "PerformanceMeasure");
      }
      entryType = "measure";
    };
    PerformanceResourceTiming = class extends PerformanceEntry {
      static {
        __name(this, "PerformanceResourceTiming");
      }
      entryType = "resource";
      serverTiming = [];
      connectEnd = 0;
      connectStart = 0;
      decodedBodySize = 0;
      domainLookupEnd = 0;
      domainLookupStart = 0;
      encodedBodySize = 0;
      fetchStart = 0;
      initiatorType = "";
      name = "";
      nextHopProtocol = "";
      redirectEnd = 0;
      redirectStart = 0;
      requestStart = 0;
      responseEnd = 0;
      responseStart = 0;
      secureConnectionStart = 0;
      startTime = 0;
      transferSize = 0;
      workerStart = 0;
      responseStatus = 0;
    };
    PerformanceObserverEntryList = class {
      static {
        __name(this, "PerformanceObserverEntryList");
      }
      __unenv__ = true;
      getEntries() {
        return [];
      }
      getEntriesByName(_name, _type) {
        return [];
      }
      getEntriesByType(type) {
        return [];
      }
    };
    Performance = class {
      static {
        __name(this, "Performance");
      }
      __unenv__ = true;
      timeOrigin = _timeOrigin;
      eventCounts = /* @__PURE__ */ new Map();
      _entries = [];
      _resourceTimingBufferSize = 0;
      navigation = void 0;
      timing = void 0;
      timerify(_fn, _options) {
        throw createNotImplementedError("Performance.timerify");
      }
      get nodeTiming() {
        return nodeTiming;
      }
      eventLoopUtilization() {
        return {};
      }
      markResourceTiming() {
        return new PerformanceResourceTiming("");
      }
      onresourcetimingbufferfull = null;
      now() {
        if (this.timeOrigin === _timeOrigin) {
          return _performanceNow();
        }
        return Date.now() - this.timeOrigin;
      }
      clearMarks(markName) {
        this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
      }
      clearMeasures(measureName) {
        this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
      }
      clearResourceTimings() {
        this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
      }
      getEntries() {
        return this._entries;
      }
      getEntriesByName(name, type) {
        return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
      }
      getEntriesByType(type) {
        return this._entries.filter((e) => e.entryType === type);
      }
      mark(name, options) {
        const entry = new PerformanceMark(name, options);
        this._entries.push(entry);
        return entry;
      }
      measure(measureName, startOrMeasureOptions, endMark) {
        let start;
        let end;
        if (typeof startOrMeasureOptions === "string") {
          start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
          end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
        } else {
          start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
          end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
        }
        const entry = new PerformanceMeasure(measureName, {
          startTime: start,
          detail: {
            start,
            end
          }
        });
        this._entries.push(entry);
        return entry;
      }
      setResourceTimingBufferSize(maxSize) {
        this._resourceTimingBufferSize = maxSize;
      }
      addEventListener(type, listener, options) {
        throw createNotImplementedError("Performance.addEventListener");
      }
      removeEventListener(type, listener, options) {
        throw createNotImplementedError("Performance.removeEventListener");
      }
      dispatchEvent(event) {
        throw createNotImplementedError("Performance.dispatchEvent");
      }
      toJSON() {
        return this;
      }
    };
    PerformanceObserver = class {
      static {
        __name(this, "PerformanceObserver");
      }
      __unenv__ = true;
      static supportedEntryTypes = [];
      _callback = null;
      constructor(callback) {
        this._callback = callback;
      }
      takeRecords() {
        return [];
      }
      disconnect() {
        throw createNotImplementedError("PerformanceObserver.disconnect");
      }
      observe(options) {
        throw createNotImplementedError("PerformanceObserver.observe");
      }
      bind(fn) {
        return fn;
      }
      runInAsyncScope(fn, thisArg, ...args) {
        return fn.call(thisArg, ...args);
      }
      asyncId() {
        return 0;
      }
      triggerAsyncId() {
        return 0;
      }
      emitDestroy() {
        return this;
      }
    };
    performance2 = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/perf_hooks.mjs
var init_perf_hooks = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/perf_hooks.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_performance();
  }
});

// ../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
var init_performance2 = __esm({
  "../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs"() {
    init_perf_hooks();
    globalThis.performance = performance2;
    globalThis.Performance = Performance;
    globalThis.PerformanceEntry = PerformanceEntry;
    globalThis.PerformanceMark = PerformanceMark;
    globalThis.PerformanceMeasure = PerformanceMeasure;
    globalThis.PerformanceObserver = PerformanceObserver;
    globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
    globalThis.PerformanceResourceTiming = PerformanceResourceTiming;
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default;
var init_noop = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/mock/noop.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    noop_default = Object.assign(() => {
    }, { __unenv__: true });
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";
var _console, _ignoreErrors, _stderr, _stdout, log, info, trace, debug, table, error, warn, createTask, clear, count, countReset, dir, dirxml, group, groupEnd, groupCollapsed, profile, profileEnd, time, timeEnd, timeLog, timeStamp, Console, _times, _stdoutErrorHandler, _stderrErrorHandler;
var init_console = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/console.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_noop();
    init_utils();
    _console = globalThis.console;
    _ignoreErrors = true;
    _stderr = new Writable();
    _stdout = new Writable();
    log = _console?.log ?? noop_default;
    info = _console?.info ?? log;
    trace = _console?.trace ?? info;
    debug = _console?.debug ?? log;
    table = _console?.table ?? log;
    error = _console?.error ?? log;
    warn = _console?.warn ?? error;
    createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
    clear = _console?.clear ?? noop_default;
    count = _console?.count ?? noop_default;
    countReset = _console?.countReset ?? noop_default;
    dir = _console?.dir ?? noop_default;
    dirxml = _console?.dirxml ?? noop_default;
    group = _console?.group ?? noop_default;
    groupEnd = _console?.groupEnd ?? noop_default;
    groupCollapsed = _console?.groupCollapsed ?? noop_default;
    profile = _console?.profile ?? noop_default;
    profileEnd = _console?.profileEnd ?? noop_default;
    time = _console?.time ?? noop_default;
    timeEnd = _console?.timeEnd ?? noop_default;
    timeLog = _console?.timeLog ?? noop_default;
    timeStamp = _console?.timeStamp ?? noop_default;
    Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
    _times = /* @__PURE__ */ new Map();
    _stdoutErrorHandler = noop_default;
    _stderrErrorHandler = noop_default;
  }
});

// ../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole, assert, clear2, context, count2, countReset2, createTask2, debug2, dir2, dirxml2, error2, group2, groupCollapsed2, groupEnd2, info2, log2, profile2, profileEnd2, table2, time2, timeEnd2, timeLog2, timeStamp2, trace2, warn2, console_default;
var init_console2 = __esm({
  "../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_console();
    workerdConsole = globalThis["console"];
    ({
      assert,
      clear: clear2,
      context: (
        // @ts-expect-error undocumented public API
        context
      ),
      count: count2,
      countReset: countReset2,
      createTask: (
        // @ts-expect-error undocumented public API
        createTask2
      ),
      debug: debug2,
      dir: dir2,
      dirxml: dirxml2,
      error: error2,
      group: group2,
      groupCollapsed: groupCollapsed2,
      groupEnd: groupEnd2,
      info: info2,
      log: log2,
      profile: profile2,
      profileEnd: profileEnd2,
      table: table2,
      time: time2,
      timeEnd: timeEnd2,
      timeLog: timeLog2,
      timeStamp: timeStamp2,
      trace: trace2,
      warn: warn2
    } = workerdConsole);
    Object.assign(workerdConsole, {
      Console,
      _ignoreErrors,
      _stderr,
      _stderrErrorHandler,
      _stdout,
      _stdoutErrorHandler,
      _times
    });
    console_default = workerdConsole;
  }
});

// ../../node_modules/.pnpm/alchemy@0.78.0_@libsql+client@0.15.15_drizzle-orm@0.44.7_@cloudflare+workers-types@4.20_aa1fc975f5d7adc8e8577ad56500baa1/node_modules/alchemy/lib/cloudflare/bundle/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console = __esm({
  "../../node_modules/.pnpm/alchemy@0.78.0_@libsql+client@0.15.15_drizzle-orm@0.44.7_@cloudflare+workers-types@4.20_aa1fc975f5d7adc8e8577ad56500baa1/node_modules/alchemy/lib/cloudflare/bundle/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console"() {
    init_console2();
    globalThis.console = console_default;
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime;
var init_hrtime = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
      const now = Date.now();
      const seconds = Math.trunc(now / 1e3);
      const nanos = now % 1e3 * 1e6;
      if (startTime) {
        let diffSeconds = seconds - startTime[0];
        let diffNanos = nanos - startTime[0];
        if (diffNanos < 0) {
          diffSeconds = diffSeconds - 1;
          diffNanos = 1e9 + diffNanos;
        }
        return [diffSeconds, diffNanos];
      }
      return [seconds, nanos];
    }, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
      return BigInt(Date.now() * 1e6);
    }, "bigint") });
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream;
var init_read_stream = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    ReadStream = class {
      static {
        __name(this, "ReadStream");
      }
      fd;
      isRaw = false;
      isTTY = false;
      constructor(fd) {
        this.fd = fd;
      }
      setRawMode(mode) {
        this.isRaw = mode;
        return this;
      }
    };
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream;
var init_write_stream = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    WriteStream = class {
      static {
        __name(this, "WriteStream");
      }
      fd;
      columns = 80;
      rows = 24;
      isTTY = false;
      constructor(fd) {
        this.fd = fd;
      }
      clearLine(dir3, callback) {
        callback && callback();
        return false;
      }
      clearScreenDown(callback) {
        callback && callback();
        return false;
      }
      cursorTo(x, y, callback) {
        callback && typeof callback === "function" && callback();
        return false;
      }
      moveCursor(dx, dy, callback) {
        callback && callback();
        return false;
      }
      getColorDepth(env3) {
        return 1;
      }
      hasColors(count3, env3) {
        return false;
      }
      getWindowSize() {
        return [this.columns, this.rows];
      }
      write(str, encoding, cb) {
        if (str instanceof Uint8Array) {
          str = new TextDecoder().decode(str);
        }
        try {
          console.log(str);
        } catch {
        }
        cb && typeof cb === "function" && cb();
        return false;
      }
    };
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/tty.mjs
var init_tty = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/tty.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_read_stream();
    init_write_stream();
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION;
var init_node_version = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    NODE_VERSION = "22.14.0";
  }
});

// ../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";
var Process;
var init_process = __esm({
  "../../node_modules/.pnpm/unenv@2.0.0-rc.21/node_modules/unenv/dist/runtime/node/internal/process/process.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_tty();
    init_utils();
    init_node_version();
    Process = class _Process extends EventEmitter {
      static {
        __name(this, "Process");
      }
      env;
      hrtime;
      nextTick;
      constructor(impl) {
        super();
        this.env = impl.env;
        this.hrtime = impl.hrtime;
        this.nextTick = impl.nextTick;
        for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
          const value = this[prop];
          if (typeof value === "function") {
            this[prop] = value.bind(this);
          }
        }
      }
      // --- event emitter ---
      emitWarning(warning, type, code) {
        console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
      }
      emit(...args) {
        return super.emit(...args);
      }
      listeners(eventName) {
        return super.listeners(eventName);
      }
      // --- stdio (lazy initializers) ---
      #stdin;
      #stdout;
      #stderr;
      get stdin() {
        return this.#stdin ??= new ReadStream(0);
      }
      get stdout() {
        return this.#stdout ??= new WriteStream(1);
      }
      get stderr() {
        return this.#stderr ??= new WriteStream(2);
      }
      // --- cwd ---
      #cwd = "/";
      chdir(cwd2) {
        this.#cwd = cwd2;
      }
      cwd() {
        return this.#cwd;
      }
      // --- dummy props and getters ---
      arch = "";
      platform = "";
      argv = [];
      argv0 = "";
      execArgv = [];
      execPath = "";
      title = "";
      pid = 200;
      ppid = 100;
      get version() {
        return `v${NODE_VERSION}`;
      }
      get versions() {
        return { node: NODE_VERSION };
      }
      get allowedNodeEnvironmentFlags() {
        return /* @__PURE__ */ new Set();
      }
      get sourceMapsEnabled() {
        return false;
      }
      get debugPort() {
        return 0;
      }
      get throwDeprecation() {
        return false;
      }
      get traceDeprecation() {
        return false;
      }
      get features() {
        return {};
      }
      get release() {
        return {};
      }
      get connected() {
        return false;
      }
      get config() {
        return {};
      }
      get moduleLoadList() {
        return [];
      }
      constrainedMemory() {
        return 0;
      }
      availableMemory() {
        return 0;
      }
      uptime() {
        return 0;
      }
      resourceUsage() {
        return {};
      }
      // --- noop methods ---
      ref() {
      }
      unref() {
      }
      // --- unimplemented methods ---
      umask() {
        throw createNotImplementedError("process.umask");
      }
      getBuiltinModule() {
        return void 0;
      }
      getActiveResourcesInfo() {
        throw createNotImplementedError("process.getActiveResourcesInfo");
      }
      exit() {
        throw createNotImplementedError("process.exit");
      }
      reallyExit() {
        throw createNotImplementedError("process.reallyExit");
      }
      kill() {
        throw createNotImplementedError("process.kill");
      }
      abort() {
        throw createNotImplementedError("process.abort");
      }
      dlopen() {
        throw createNotImplementedError("process.dlopen");
      }
      setSourceMapsEnabled() {
        throw createNotImplementedError("process.setSourceMapsEnabled");
      }
      loadEnvFile() {
        throw createNotImplementedError("process.loadEnvFile");
      }
      disconnect() {
        throw createNotImplementedError("process.disconnect");
      }
      cpuUsage() {
        throw createNotImplementedError("process.cpuUsage");
      }
      setUncaughtExceptionCaptureCallback() {
        throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
      }
      hasUncaughtExceptionCaptureCallback() {
        throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
      }
      initgroups() {
        throw createNotImplementedError("process.initgroups");
      }
      openStdin() {
        throw createNotImplementedError("process.openStdin");
      }
      assert() {
        throw createNotImplementedError("process.assert");
      }
      binding() {
        throw createNotImplementedError("process.binding");
      }
      // --- attached interfaces ---
      permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
      report = {
        directory: "",
        filename: "",
        signal: "SIGUSR2",
        compact: false,
        reportOnFatalError: false,
        reportOnSignal: false,
        reportOnUncaughtException: false,
        getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
        writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
      };
      finalization = {
        register: /* @__PURE__ */ notImplemented("process.finalization.register"),
        unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
        registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
      };
      memoryUsage = Object.assign(() => ({
        arrayBuffers: 0,
        rss: 0,
        external: 0,
        heapTotal: 0,
        heapUsed: 0
      }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
      // --- undefined props ---
      mainModule = void 0;
      domain = void 0;
      // optional
      send = void 0;
      exitCode = void 0;
      channel = void 0;
      getegid = void 0;
      geteuid = void 0;
      getgid = void 0;
      getgroups = void 0;
      getuid = void 0;
      setegid = void 0;
      seteuid = void 0;
      setgid = void 0;
      setgroups = void 0;
      setuid = void 0;
      // internals
      _events = void 0;
      _eventsCount = void 0;
      _exiting = void 0;
      _maxListeners = void 0;
      _debugEnd = void 0;
      _debugProcess = void 0;
      _fatalException = void 0;
      _getActiveHandles = void 0;
      _getActiveRequests = void 0;
      _kill = void 0;
      _preload_modules = void 0;
      _rawDebug = void 0;
      _startProfilerIdleNotifier = void 0;
      _stopProfilerIdleNotifier = void 0;
      _tickCallback = void 0;
      _disconnect = void 0;
      _handleQueue = void 0;
      _pendingMessage = void 0;
      _channel = void 0;
      _send = void 0;
      _linkedBinding = void 0;
    };
  }
});

// ../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess, getBuiltinModule, workerdProcess, isWorkerdProcessV2, unenvProcess, exit, features, platform, env, hrtime3, nextTick, _channel, _disconnect, _events, _eventsCount, _handleQueue, _maxListeners, _pendingMessage, _send, assert2, disconnect, mainModule, _debugEnd, _debugProcess, _exiting, _fatalException, _getActiveHandles, _getActiveRequests, _kill, _linkedBinding, _preload_modules, _rawDebug, _startProfilerIdleNotifier, _stopProfilerIdleNotifier, _tickCallback, abort, addListener, allowedNodeEnvironmentFlags, arch, argv, argv0, availableMemory, binding, channel, chdir, config, connected, constrainedMemory, cpuUsage, cwd, debugPort, dlopen, domain, emit, emitWarning, eventNames, execArgv, execPath, exitCode, finalization, getActiveResourcesInfo, getegid, geteuid, getgid, getgroups, getMaxListeners, getuid, hasUncaughtExceptionCaptureCallback, initgroups, kill, listenerCount, listeners, loadEnvFile, memoryUsage, moduleLoadList, off, on, once, openStdin, permission, pid, ppid, prependListener, prependOnceListener, rawListeners, reallyExit, ref, release, removeAllListeners, removeListener, report, resourceUsage, send, setegid, seteuid, setgid, setgroups, setMaxListeners, setSourceMapsEnabled, setuid, setUncaughtExceptionCaptureCallback, sourceMapsEnabled, stderr, stdin, stdout, throwDeprecation, title, traceDeprecation, umask, unref, uptime, version, versions, _process, process_default;
var init_process2 = __esm({
  "../../node_modules/.pnpm/@cloudflare+unenv-preset@2.7.7_unenv@2.0.0-rc.21_workerd@1.20251118.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_hrtime();
    init_process();
    globalProcess = globalThis["process"];
    getBuiltinModule = globalProcess.getBuiltinModule;
    workerdProcess = getBuiltinModule("node:process");
    isWorkerdProcessV2 = globalThis.Cloudflare.compatibilityFlags.enable_nodejs_process_v2;
    unenvProcess = new Process({
      env: globalProcess.env,
      // `hrtime` is only available from workerd process v2
      hrtime: isWorkerdProcessV2 ? workerdProcess.hrtime : hrtime,
      // `nextTick` is available from workerd process v1
      nextTick: workerdProcess.nextTick
    });
    ({ exit, features, platform } = workerdProcess);
    ({
      env: (
        // Always implemented by workerd
        env
      ),
      hrtime: (
        // Only implemented in workerd v2
        hrtime3
      ),
      nextTick: (
        // Always implemented by workerd
        nextTick
      )
    } = unenvProcess);
    ({
      _channel,
      _disconnect,
      _events,
      _eventsCount,
      _handleQueue,
      _maxListeners,
      _pendingMessage,
      _send,
      assert: assert2,
      disconnect,
      mainModule
    } = unenvProcess);
    ({
      _debugEnd: (
        // @ts-expect-error `_debugEnd` is missing typings
        _debugEnd
      ),
      _debugProcess: (
        // @ts-expect-error `_debugProcess` is missing typings
        _debugProcess
      ),
      _exiting: (
        // @ts-expect-error `_exiting` is missing typings
        _exiting
      ),
      _fatalException: (
        // @ts-expect-error `_fatalException` is missing typings
        _fatalException
      ),
      _getActiveHandles: (
        // @ts-expect-error `_getActiveHandles` is missing typings
        _getActiveHandles
      ),
      _getActiveRequests: (
        // @ts-expect-error `_getActiveRequests` is missing typings
        _getActiveRequests
      ),
      _kill: (
        // @ts-expect-error `_kill` is missing typings
        _kill
      ),
      _linkedBinding: (
        // @ts-expect-error `_linkedBinding` is missing typings
        _linkedBinding
      ),
      _preload_modules: (
        // @ts-expect-error `_preload_modules` is missing typings
        _preload_modules
      ),
      _rawDebug: (
        // @ts-expect-error `_rawDebug` is missing typings
        _rawDebug
      ),
      _startProfilerIdleNotifier: (
        // @ts-expect-error `_startProfilerIdleNotifier` is missing typings
        _startProfilerIdleNotifier
      ),
      _stopProfilerIdleNotifier: (
        // @ts-expect-error `_stopProfilerIdleNotifier` is missing typings
        _stopProfilerIdleNotifier
      ),
      _tickCallback: (
        // @ts-expect-error `_tickCallback` is missing typings
        _tickCallback
      ),
      abort,
      addListener,
      allowedNodeEnvironmentFlags,
      arch,
      argv,
      argv0,
      availableMemory,
      binding: (
        // @ts-expect-error `binding` is missing typings
        binding
      ),
      channel,
      chdir,
      config,
      connected,
      constrainedMemory,
      cpuUsage,
      cwd,
      debugPort,
      dlopen,
      domain: (
        // @ts-expect-error `domain` is missing typings
        domain
      ),
      emit,
      emitWarning,
      eventNames,
      execArgv,
      execPath,
      exitCode,
      finalization,
      getActiveResourcesInfo,
      getegid,
      geteuid,
      getgid,
      getgroups,
      getMaxListeners,
      getuid,
      hasUncaughtExceptionCaptureCallback,
      initgroups: (
        // @ts-expect-error `initgroups` is missing typings
        initgroups
      ),
      kill,
      listenerCount,
      listeners,
      loadEnvFile,
      memoryUsage,
      moduleLoadList: (
        // @ts-expect-error `moduleLoadList` is missing typings
        moduleLoadList
      ),
      off,
      on,
      once,
      openStdin: (
        // @ts-expect-error `openStdin` is missing typings
        openStdin
      ),
      permission,
      pid,
      ppid,
      prependListener,
      prependOnceListener,
      rawListeners,
      reallyExit: (
        // @ts-expect-error `reallyExit` is missing typings
        reallyExit
      ),
      ref,
      release,
      removeAllListeners,
      removeListener,
      report,
      resourceUsage,
      send,
      setegid,
      seteuid,
      setgid,
      setgroups,
      setMaxListeners,
      setSourceMapsEnabled,
      setuid,
      setUncaughtExceptionCaptureCallback,
      sourceMapsEnabled,
      stderr,
      stdin,
      stdout,
      throwDeprecation,
      title,
      traceDeprecation,
      umask,
      unref,
      uptime,
      version,
      versions
    } = isWorkerdProcessV2 ? workerdProcess : unenvProcess);
    _process = {
      abort,
      addListener,
      allowedNodeEnvironmentFlags,
      hasUncaughtExceptionCaptureCallback,
      setUncaughtExceptionCaptureCallback,
      loadEnvFile,
      sourceMapsEnabled,
      arch,
      argv,
      argv0,
      chdir,
      config,
      connected,
      constrainedMemory,
      availableMemory,
      cpuUsage,
      cwd,
      debugPort,
      dlopen,
      disconnect,
      emit,
      emitWarning,
      env,
      eventNames,
      execArgv,
      execPath,
      exit,
      finalization,
      features,
      getBuiltinModule,
      getActiveResourcesInfo,
      getMaxListeners,
      hrtime: hrtime3,
      kill,
      listeners,
      listenerCount,
      memoryUsage,
      nextTick,
      on,
      off,
      once,
      pid,
      platform,
      ppid,
      prependListener,
      prependOnceListener,
      rawListeners,
      release,
      removeAllListeners,
      removeListener,
      report,
      resourceUsage,
      setMaxListeners,
      setSourceMapsEnabled,
      stderr,
      stdin,
      stdout,
      title,
      throwDeprecation,
      traceDeprecation,
      umask,
      uptime,
      version,
      versions,
      // @ts-expect-error old API
      domain,
      initgroups,
      moduleLoadList,
      reallyExit,
      openStdin,
      assert: assert2,
      binding,
      send,
      exitCode,
      channel,
      getegid,
      geteuid,
      getgid,
      getgroups,
      getuid,
      setegid,
      seteuid,
      setgid,
      setgroups,
      setuid,
      permission,
      mainModule,
      _events,
      _eventsCount,
      _exiting,
      _maxListeners,
      _debugEnd,
      _debugProcess,
      _fatalException,
      _getActiveHandles,
      _getActiveRequests,
      _kill,
      _preload_modules,
      _rawDebug,
      _startProfilerIdleNotifier,
      _stopProfilerIdleNotifier,
      _tickCallback,
      _disconnect,
      _handleQueue,
      _pendingMessage,
      _channel,
      _send,
      _linkedBinding
    };
    process_default = _process;
  }
});

// ../../node_modules/.pnpm/alchemy@0.78.0_@libsql+client@0.15.15_drizzle-orm@0.44.7_@cloudflare+workers-types@4.20_aa1fc975f5d7adc8e8577ad56500baa1/node_modules/alchemy/lib/cloudflare/bundle/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process = __esm({
  "../../node_modules/.pnpm/alchemy@0.78.0_@libsql+client@0.15.15_drizzle-orm@0.44.7_@cloudflare+workers-types@4.20_aa1fc975f5d7adc8e8577ad56500baa1/node_modules/alchemy/lib/cloudflare/bundle/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process"() {
    init_process2();
    globalThis.process = process_default;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/platform/browser/globalThis.js
var require_globalThis = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/platform/browser/globalThis.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports._globalThis = void 0;
    exports._globalThis = typeof globalThis === "object" ? globalThis : typeof self === "object" ? self : typeof window === "object" ? window : typeof global === "object" ? global : {};
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/platform/browser/index.js
var require_browser = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/platform/browser/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      Object.defineProperty(o, k2, { enumerable: true, get: /* @__PURE__ */ __name(function() {
        return m[k];
      }, "get") });
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_globalThis(), exports);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/version.js
var require_version = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/version.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VERSION = void 0;
    exports.VERSION = "1.9.0";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/internal/semver.js
var require_semver = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/internal/semver.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isCompatible = exports._makeCompatibilityCheck = void 0;
    var version_1 = require_version();
    var re = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/;
    function _makeCompatibilityCheck(ownVersion) {
      const acceptedVersions = /* @__PURE__ */ new Set([ownVersion]);
      const rejectedVersions = /* @__PURE__ */ new Set();
      const myVersionMatch = ownVersion.match(re);
      if (!myVersionMatch) {
        return () => false;
      }
      const ownVersionParsed = {
        major: +myVersionMatch[1],
        minor: +myVersionMatch[2],
        patch: +myVersionMatch[3],
        prerelease: myVersionMatch[4]
      };
      if (ownVersionParsed.prerelease != null) {
        return /* @__PURE__ */ __name(function isExactmatch(globalVersion) {
          return globalVersion === ownVersion;
        }, "isExactmatch");
      }
      function _reject(v) {
        rejectedVersions.add(v);
        return false;
      }
      __name(_reject, "_reject");
      function _accept(v) {
        acceptedVersions.add(v);
        return true;
      }
      __name(_accept, "_accept");
      return /* @__PURE__ */ __name(function isCompatible(globalVersion) {
        if (acceptedVersions.has(globalVersion)) {
          return true;
        }
        if (rejectedVersions.has(globalVersion)) {
          return false;
        }
        const globalVersionMatch = globalVersion.match(re);
        if (!globalVersionMatch) {
          return _reject(globalVersion);
        }
        const globalVersionParsed = {
          major: +globalVersionMatch[1],
          minor: +globalVersionMatch[2],
          patch: +globalVersionMatch[3],
          prerelease: globalVersionMatch[4]
        };
        if (globalVersionParsed.prerelease != null) {
          return _reject(globalVersion);
        }
        if (ownVersionParsed.major !== globalVersionParsed.major) {
          return _reject(globalVersion);
        }
        if (ownVersionParsed.major === 0) {
          if (ownVersionParsed.minor === globalVersionParsed.minor && ownVersionParsed.patch <= globalVersionParsed.patch) {
            return _accept(globalVersion);
          }
          return _reject(globalVersion);
        }
        if (ownVersionParsed.minor <= globalVersionParsed.minor) {
          return _accept(globalVersion);
        }
        return _reject(globalVersion);
      }, "isCompatible");
    }
    __name(_makeCompatibilityCheck, "_makeCompatibilityCheck");
    exports._makeCompatibilityCheck = _makeCompatibilityCheck;
    exports.isCompatible = _makeCompatibilityCheck(version_1.VERSION);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/internal/global-utils.js
var require_global_utils = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/internal/global-utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unregisterGlobal = exports.getGlobal = exports.registerGlobal = void 0;
    var platform_1 = require_browser();
    var version_1 = require_version();
    var semver_1 = require_semver();
    var major = version_1.VERSION.split(".")[0];
    var GLOBAL_OPENTELEMETRY_API_KEY = Symbol.for(`opentelemetry.js.api.${major}`);
    var _global = platform_1._globalThis;
    function registerGlobal(type, instance, diag, allowOverride = false) {
      var _a;
      const api = _global[GLOBAL_OPENTELEMETRY_API_KEY] = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) !== null && _a !== void 0 ? _a : {
        version: version_1.VERSION
      };
      if (!allowOverride && api[type]) {
        const err = new Error(`@opentelemetry/api: Attempted duplicate registration of API: ${type}`);
        diag.error(err.stack || err.message);
        return false;
      }
      if (api.version !== version_1.VERSION) {
        const err = new Error(`@opentelemetry/api: Registration of version v${api.version} for ${type} does not match previously registered API v${version_1.VERSION}`);
        diag.error(err.stack || err.message);
        return false;
      }
      api[type] = instance;
      diag.debug(`@opentelemetry/api: Registered a global for ${type} v${version_1.VERSION}.`);
      return true;
    }
    __name(registerGlobal, "registerGlobal");
    exports.registerGlobal = registerGlobal;
    function getGlobal(type) {
      var _a, _b;
      const globalVersion = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _a === void 0 ? void 0 : _a.version;
      if (!globalVersion || !(0, semver_1.isCompatible)(globalVersion)) {
        return;
      }
      return (_b = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _b === void 0 ? void 0 : _b[type];
    }
    __name(getGlobal, "getGlobal");
    exports.getGlobal = getGlobal;
    function unregisterGlobal(type, diag) {
      diag.debug(`@opentelemetry/api: Unregistering a global for ${type} v${version_1.VERSION}.`);
      const api = _global[GLOBAL_OPENTELEMETRY_API_KEY];
      if (api) {
        delete api[type];
      }
    }
    __name(unregisterGlobal, "unregisterGlobal");
    exports.unregisterGlobal = unregisterGlobal;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/ComponentLogger.js
var require_ComponentLogger = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/ComponentLogger.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiagComponentLogger = void 0;
    var global_utils_1 = require_global_utils();
    var DiagComponentLogger = class {
      static {
        __name(this, "DiagComponentLogger");
      }
      constructor(props) {
        this._namespace = props.namespace || "DiagComponentLogger";
      }
      debug(...args) {
        return logProxy("debug", this._namespace, args);
      }
      error(...args) {
        return logProxy("error", this._namespace, args);
      }
      info(...args) {
        return logProxy("info", this._namespace, args);
      }
      warn(...args) {
        return logProxy("warn", this._namespace, args);
      }
      verbose(...args) {
        return logProxy("verbose", this._namespace, args);
      }
    };
    exports.DiagComponentLogger = DiagComponentLogger;
    function logProxy(funcName, namespace, args) {
      const logger = (0, global_utils_1.getGlobal)("diag");
      if (!logger) {
        return;
      }
      args.unshift(namespace);
      return logger[funcName](...args);
    }
    __name(logProxy, "logProxy");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/types.js
var require_types = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/types.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiagLogLevel = void 0;
    var DiagLogLevel;
    (function(DiagLogLevel2) {
      DiagLogLevel2[DiagLogLevel2["NONE"] = 0] = "NONE";
      DiagLogLevel2[DiagLogLevel2["ERROR"] = 30] = "ERROR";
      DiagLogLevel2[DiagLogLevel2["WARN"] = 50] = "WARN";
      DiagLogLevel2[DiagLogLevel2["INFO"] = 60] = "INFO";
      DiagLogLevel2[DiagLogLevel2["DEBUG"] = 70] = "DEBUG";
      DiagLogLevel2[DiagLogLevel2["VERBOSE"] = 80] = "VERBOSE";
      DiagLogLevel2[DiagLogLevel2["ALL"] = 9999] = "ALL";
    })(DiagLogLevel = exports.DiagLogLevel || (exports.DiagLogLevel = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/internal/logLevelLogger.js
var require_logLevelLogger = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/internal/logLevelLogger.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createLogLevelDiagLogger = void 0;
    var types_1 = require_types();
    function createLogLevelDiagLogger(maxLevel, logger) {
      if (maxLevel < types_1.DiagLogLevel.NONE) {
        maxLevel = types_1.DiagLogLevel.NONE;
      } else if (maxLevel > types_1.DiagLogLevel.ALL) {
        maxLevel = types_1.DiagLogLevel.ALL;
      }
      logger = logger || {};
      function _filterFunc(funcName, theLevel) {
        const theFunc = logger[funcName];
        if (typeof theFunc === "function" && maxLevel >= theLevel) {
          return theFunc.bind(logger);
        }
        return function() {
        };
      }
      __name(_filterFunc, "_filterFunc");
      return {
        error: _filterFunc("error", types_1.DiagLogLevel.ERROR),
        warn: _filterFunc("warn", types_1.DiagLogLevel.WARN),
        info: _filterFunc("info", types_1.DiagLogLevel.INFO),
        debug: _filterFunc("debug", types_1.DiagLogLevel.DEBUG),
        verbose: _filterFunc("verbose", types_1.DiagLogLevel.VERBOSE)
      };
    }
    __name(createLogLevelDiagLogger, "createLogLevelDiagLogger");
    exports.createLogLevelDiagLogger = createLogLevelDiagLogger;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/diag.js
var require_diag = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/diag.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiagAPI = void 0;
    var ComponentLogger_1 = require_ComponentLogger();
    var logLevelLogger_1 = require_logLevelLogger();
    var types_1 = require_types();
    var global_utils_1 = require_global_utils();
    var API_NAME = "diag";
    var DiagAPI = class _DiagAPI {
      static {
        __name(this, "DiagAPI");
      }
      /**
       * Private internal constructor
       * @private
       */
      constructor() {
        function _logProxy(funcName) {
          return function(...args) {
            const logger = (0, global_utils_1.getGlobal)("diag");
            if (!logger)
              return;
            return logger[funcName](...args);
          };
        }
        __name(_logProxy, "_logProxy");
        const self2 = this;
        const setLogger = /* @__PURE__ */ __name((logger, optionsOrLogLevel = { logLevel: types_1.DiagLogLevel.INFO }) => {
          var _a, _b, _c;
          if (logger === self2) {
            const err = new Error("Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation");
            self2.error((_a = err.stack) !== null && _a !== void 0 ? _a : err.message);
            return false;
          }
          if (typeof optionsOrLogLevel === "number") {
            optionsOrLogLevel = {
              logLevel: optionsOrLogLevel
            };
          }
          const oldLogger = (0, global_utils_1.getGlobal)("diag");
          const newLogger = (0, logLevelLogger_1.createLogLevelDiagLogger)((_b = optionsOrLogLevel.logLevel) !== null && _b !== void 0 ? _b : types_1.DiagLogLevel.INFO, logger);
          if (oldLogger && !optionsOrLogLevel.suppressOverrideMessage) {
            const stack = (_c = new Error().stack) !== null && _c !== void 0 ? _c : "<failed to generate stacktrace>";
            oldLogger.warn(`Current logger will be overwritten from ${stack}`);
            newLogger.warn(`Current logger will overwrite one already registered from ${stack}`);
          }
          return (0, global_utils_1.registerGlobal)("diag", newLogger, self2, true);
        }, "setLogger");
        self2.setLogger = setLogger;
        self2.disable = () => {
          (0, global_utils_1.unregisterGlobal)(API_NAME, self2);
        };
        self2.createComponentLogger = (options) => {
          return new ComponentLogger_1.DiagComponentLogger(options);
        };
        self2.verbose = _logProxy("verbose");
        self2.debug = _logProxy("debug");
        self2.info = _logProxy("info");
        self2.warn = _logProxy("warn");
        self2.error = _logProxy("error");
      }
      /** Get the singleton instance of the DiagAPI API */
      static instance() {
        if (!this._instance) {
          this._instance = new _DiagAPI();
        }
        return this._instance;
      }
    };
    exports.DiagAPI = DiagAPI;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/internal/baggage-impl.js
var require_baggage_impl = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/internal/baggage-impl.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BaggageImpl = void 0;
    var BaggageImpl = class _BaggageImpl {
      static {
        __name(this, "BaggageImpl");
      }
      constructor(entries) {
        this._entries = entries ? new Map(entries) : /* @__PURE__ */ new Map();
      }
      getEntry(key) {
        const entry = this._entries.get(key);
        if (!entry) {
          return void 0;
        }
        return Object.assign({}, entry);
      }
      getAllEntries() {
        return Array.from(this._entries.entries()).map(([k, v]) => [k, v]);
      }
      setEntry(key, entry) {
        const newBaggage = new _BaggageImpl(this._entries);
        newBaggage._entries.set(key, entry);
        return newBaggage;
      }
      removeEntry(key) {
        const newBaggage = new _BaggageImpl(this._entries);
        newBaggage._entries.delete(key);
        return newBaggage;
      }
      removeEntries(...keys) {
        const newBaggage = new _BaggageImpl(this._entries);
        for (const key of keys) {
          newBaggage._entries.delete(key);
        }
        return newBaggage;
      }
      clear() {
        return new _BaggageImpl();
      }
    };
    exports.BaggageImpl = BaggageImpl;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/internal/symbol.js
var require_symbol = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/internal/symbol.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.baggageEntryMetadataSymbol = void 0;
    exports.baggageEntryMetadataSymbol = Symbol("BaggageEntryMetadata");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.baggageEntryMetadataFromString = exports.createBaggage = void 0;
    var diag_1 = require_diag();
    var baggage_impl_1 = require_baggage_impl();
    var symbol_1 = require_symbol();
    var diag = diag_1.DiagAPI.instance();
    function createBaggage(entries = {}) {
      return new baggage_impl_1.BaggageImpl(new Map(Object.entries(entries)));
    }
    __name(createBaggage, "createBaggage");
    exports.createBaggage = createBaggage;
    function baggageEntryMetadataFromString(str) {
      if (typeof str !== "string") {
        diag.error(`Cannot create baggage metadata from unknown type: ${typeof str}`);
        str = "";
      }
      return {
        __TYPE__: symbol_1.baggageEntryMetadataSymbol,
        toString() {
          return str;
        }
      };
    }
    __name(baggageEntryMetadataFromString, "baggageEntryMetadataFromString");
    exports.baggageEntryMetadataFromString = baggageEntryMetadataFromString;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context/context.js
var require_context = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context/context.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ROOT_CONTEXT = exports.createContextKey = void 0;
    function createContextKey2(description) {
      return Symbol.for(description);
    }
    __name(createContextKey2, "createContextKey");
    exports.createContextKey = createContextKey2;
    var BaseContext = class _BaseContext {
      static {
        __name(this, "BaseContext");
      }
      /**
       * Construct a new context which inherits values from an optional parent context.
       *
       * @param parentContext a context from which to inherit values
       */
      constructor(parentContext) {
        const self2 = this;
        self2._currentContext = parentContext ? new Map(parentContext) : /* @__PURE__ */ new Map();
        self2.getValue = (key) => self2._currentContext.get(key);
        self2.setValue = (key, value) => {
          const context4 = new _BaseContext(self2._currentContext);
          context4._currentContext.set(key, value);
          return context4;
        };
        self2.deleteValue = (key) => {
          const context4 = new _BaseContext(self2._currentContext);
          context4._currentContext.delete(key);
          return context4;
        };
      }
    };
    exports.ROOT_CONTEXT = new BaseContext();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/consoleLogger.js
var require_consoleLogger = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag/consoleLogger.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiagConsoleLogger = void 0;
    var consoleMap = [
      { n: "error", c: "error" },
      { n: "warn", c: "warn" },
      { n: "info", c: "info" },
      { n: "debug", c: "debug" },
      { n: "verbose", c: "trace" }
    ];
    var DiagConsoleLogger = class {
      static {
        __name(this, "DiagConsoleLogger");
      }
      constructor() {
        function _consoleFunc(funcName) {
          return function(...args) {
            if (console) {
              let theFunc = console[funcName];
              if (typeof theFunc !== "function") {
                theFunc = console.log;
              }
              if (typeof theFunc === "function") {
                return theFunc.apply(console, args);
              }
            }
          };
        }
        __name(_consoleFunc, "_consoleFunc");
        for (let i = 0; i < consoleMap.length; i++) {
          this[consoleMap[i].n] = _consoleFunc(consoleMap[i].c);
        }
      }
    };
    exports.DiagConsoleLogger = DiagConsoleLogger;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/NoopMeter.js
var require_NoopMeter = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/NoopMeter.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createNoopMeter = exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC = exports.NOOP_OBSERVABLE_GAUGE_METRIC = exports.NOOP_OBSERVABLE_COUNTER_METRIC = exports.NOOP_UP_DOWN_COUNTER_METRIC = exports.NOOP_HISTOGRAM_METRIC = exports.NOOP_GAUGE_METRIC = exports.NOOP_COUNTER_METRIC = exports.NOOP_METER = exports.NoopObservableUpDownCounterMetric = exports.NoopObservableGaugeMetric = exports.NoopObservableCounterMetric = exports.NoopObservableMetric = exports.NoopHistogramMetric = exports.NoopGaugeMetric = exports.NoopUpDownCounterMetric = exports.NoopCounterMetric = exports.NoopMetric = exports.NoopMeter = void 0;
    var NoopMeter = class {
      static {
        __name(this, "NoopMeter");
      }
      constructor() {
      }
      /**
       * @see {@link Meter.createGauge}
       */
      createGauge(_name, _options) {
        return exports.NOOP_GAUGE_METRIC;
      }
      /**
       * @see {@link Meter.createHistogram}
       */
      createHistogram(_name, _options) {
        return exports.NOOP_HISTOGRAM_METRIC;
      }
      /**
       * @see {@link Meter.createCounter}
       */
      createCounter(_name, _options) {
        return exports.NOOP_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createUpDownCounter}
       */
      createUpDownCounter(_name, _options) {
        return exports.NOOP_UP_DOWN_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createObservableGauge}
       */
      createObservableGauge(_name, _options) {
        return exports.NOOP_OBSERVABLE_GAUGE_METRIC;
      }
      /**
       * @see {@link Meter.createObservableCounter}
       */
      createObservableCounter(_name, _options) {
        return exports.NOOP_OBSERVABLE_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createObservableUpDownCounter}
       */
      createObservableUpDownCounter(_name, _options) {
        return exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.addBatchObservableCallback}
       */
      addBatchObservableCallback(_callback, _observables) {
      }
      /**
       * @see {@link Meter.removeBatchObservableCallback}
       */
      removeBatchObservableCallback(_callback) {
      }
    };
    exports.NoopMeter = NoopMeter;
    var NoopMetric = class {
      static {
        __name(this, "NoopMetric");
      }
    };
    exports.NoopMetric = NoopMetric;
    var NoopCounterMetric = class extends NoopMetric {
      static {
        __name(this, "NoopCounterMetric");
      }
      add(_value, _attributes) {
      }
    };
    exports.NoopCounterMetric = NoopCounterMetric;
    var NoopUpDownCounterMetric = class extends NoopMetric {
      static {
        __name(this, "NoopUpDownCounterMetric");
      }
      add(_value, _attributes) {
      }
    };
    exports.NoopUpDownCounterMetric = NoopUpDownCounterMetric;
    var NoopGaugeMetric = class extends NoopMetric {
      static {
        __name(this, "NoopGaugeMetric");
      }
      record(_value, _attributes) {
      }
    };
    exports.NoopGaugeMetric = NoopGaugeMetric;
    var NoopHistogramMetric = class extends NoopMetric {
      static {
        __name(this, "NoopHistogramMetric");
      }
      record(_value, _attributes) {
      }
    };
    exports.NoopHistogramMetric = NoopHistogramMetric;
    var NoopObservableMetric = class {
      static {
        __name(this, "NoopObservableMetric");
      }
      addCallback(_callback) {
      }
      removeCallback(_callback) {
      }
    };
    exports.NoopObservableMetric = NoopObservableMetric;
    var NoopObservableCounterMetric = class extends NoopObservableMetric {
      static {
        __name(this, "NoopObservableCounterMetric");
      }
    };
    exports.NoopObservableCounterMetric = NoopObservableCounterMetric;
    var NoopObservableGaugeMetric = class extends NoopObservableMetric {
      static {
        __name(this, "NoopObservableGaugeMetric");
      }
    };
    exports.NoopObservableGaugeMetric = NoopObservableGaugeMetric;
    var NoopObservableUpDownCounterMetric = class extends NoopObservableMetric {
      static {
        __name(this, "NoopObservableUpDownCounterMetric");
      }
    };
    exports.NoopObservableUpDownCounterMetric = NoopObservableUpDownCounterMetric;
    exports.NOOP_METER = new NoopMeter();
    exports.NOOP_COUNTER_METRIC = new NoopCounterMetric();
    exports.NOOP_GAUGE_METRIC = new NoopGaugeMetric();
    exports.NOOP_HISTOGRAM_METRIC = new NoopHistogramMetric();
    exports.NOOP_UP_DOWN_COUNTER_METRIC = new NoopUpDownCounterMetric();
    exports.NOOP_OBSERVABLE_COUNTER_METRIC = new NoopObservableCounterMetric();
    exports.NOOP_OBSERVABLE_GAUGE_METRIC = new NoopObservableGaugeMetric();
    exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC = new NoopObservableUpDownCounterMetric();
    function createNoopMeter() {
      return exports.NOOP_METER;
    }
    __name(createNoopMeter, "createNoopMeter");
    exports.createNoopMeter = createNoopMeter;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/Metric.js
var require_Metric = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/Metric.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValueType = void 0;
    var ValueType;
    (function(ValueType2) {
      ValueType2[ValueType2["INT"] = 0] = "INT";
      ValueType2[ValueType2["DOUBLE"] = 1] = "DOUBLE";
    })(ValueType = exports.ValueType || (exports.ValueType = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation/TextMapPropagator.js
var require_TextMapPropagator = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation/TextMapPropagator.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.defaultTextMapSetter = exports.defaultTextMapGetter = void 0;
    exports.defaultTextMapGetter = {
      get(carrier, key) {
        if (carrier == null) {
          return void 0;
        }
        return carrier[key];
      },
      keys(carrier) {
        if (carrier == null) {
          return [];
        }
        return Object.keys(carrier);
      }
    };
    exports.defaultTextMapSetter = {
      set(carrier, key, value) {
        if (carrier == null) {
          return;
        }
        carrier[key] = value;
      }
    };
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context/NoopContextManager.js
var require_NoopContextManager = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context/NoopContextManager.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoopContextManager = void 0;
    var context_1 = require_context();
    var NoopContextManager = class {
      static {
        __name(this, "NoopContextManager");
      }
      active() {
        return context_1.ROOT_CONTEXT;
      }
      with(_context, fn, thisArg, ...args) {
        return fn.call(thisArg, ...args);
      }
      bind(_context, target) {
        return target;
      }
      enable() {
        return this;
      }
      disable() {
        return this;
      }
    };
    exports.NoopContextManager = NoopContextManager;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/context.js
var require_context2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/context.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContextAPI = void 0;
    var NoopContextManager_1 = require_NoopContextManager();
    var global_utils_1 = require_global_utils();
    var diag_1 = require_diag();
    var API_NAME = "context";
    var NOOP_CONTEXT_MANAGER = new NoopContextManager_1.NoopContextManager();
    var ContextAPI = class _ContextAPI {
      static {
        __name(this, "ContextAPI");
      }
      /** Empty private constructor prevents end users from constructing a new instance of the API */
      constructor() {
      }
      /** Get the singleton instance of the Context API */
      static getInstance() {
        if (!this._instance) {
          this._instance = new _ContextAPI();
        }
        return this._instance;
      }
      /**
       * Set the current context manager.
       *
       * @returns true if the context manager was successfully registered, else false
       */
      setGlobalContextManager(contextManager) {
        return (0, global_utils_1.registerGlobal)(API_NAME, contextManager, diag_1.DiagAPI.instance());
      }
      /**
       * Get the currently active context
       */
      active() {
        return this._getContextManager().active();
      }
      /**
       * Execute a function with an active context
       *
       * @param context context to be active during function execution
       * @param fn function to execute in a context
       * @param thisArg optional receiver to be used for calling fn
       * @param args optional arguments forwarded to fn
       */
      with(context4, fn, thisArg, ...args) {
        return this._getContextManager().with(context4, fn, thisArg, ...args);
      }
      /**
       * Bind a context to a target function or event emitter
       *
       * @param context context to bind to the event emitter or function. Defaults to the currently active context
       * @param target function or event emitter to bind
       */
      bind(context4, target) {
        return this._getContextManager().bind(context4, target);
      }
      _getContextManager() {
        return (0, global_utils_1.getGlobal)(API_NAME) || NOOP_CONTEXT_MANAGER;
      }
      /** Disable and remove the global context manager */
      disable() {
        this._getContextManager().disable();
        (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
      }
    };
    exports.ContextAPI = ContextAPI;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/trace_flags.js
var require_trace_flags = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/trace_flags.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TraceFlags = void 0;
    var TraceFlags2;
    (function(TraceFlags3) {
      TraceFlags3[TraceFlags3["NONE"] = 0] = "NONE";
      TraceFlags3[TraceFlags3["SAMPLED"] = 1] = "SAMPLED";
    })(TraceFlags2 = exports.TraceFlags || (exports.TraceFlags = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/invalid-span-constants.js
var require_invalid_span_constants = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/invalid-span-constants.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.INVALID_SPAN_CONTEXT = exports.INVALID_TRACEID = exports.INVALID_SPANID = void 0;
    var trace_flags_1 = require_trace_flags();
    exports.INVALID_SPANID = "0000000000000000";
    exports.INVALID_TRACEID = "00000000000000000000000000000000";
    exports.INVALID_SPAN_CONTEXT = {
      traceId: exports.INVALID_TRACEID,
      spanId: exports.INVALID_SPANID,
      traceFlags: trace_flags_1.TraceFlags.NONE
    };
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NonRecordingSpan.js
var require_NonRecordingSpan = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NonRecordingSpan.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NonRecordingSpan = void 0;
    var invalid_span_constants_1 = require_invalid_span_constants();
    var NonRecordingSpan = class {
      static {
        __name(this, "NonRecordingSpan");
      }
      constructor(_spanContext = invalid_span_constants_1.INVALID_SPAN_CONTEXT) {
        this._spanContext = _spanContext;
      }
      // Returns a SpanContext.
      spanContext() {
        return this._spanContext;
      }
      // By default does nothing
      setAttribute(_key, _value) {
        return this;
      }
      // By default does nothing
      setAttributes(_attributes) {
        return this;
      }
      // By default does nothing
      addEvent(_name, _attributes) {
        return this;
      }
      addLink(_link) {
        return this;
      }
      addLinks(_links) {
        return this;
      }
      // By default does nothing
      setStatus(_status) {
        return this;
      }
      // By default does nothing
      updateName(_name) {
        return this;
      }
      // By default does nothing
      end(_endTime) {
      }
      // isRecording always returns false for NonRecordingSpan.
      isRecording() {
        return false;
      }
      // By default does nothing
      recordException(_exception, _time) {
      }
    };
    exports.NonRecordingSpan = NonRecordingSpan;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/context-utils.js
var require_context_utils = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/context-utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSpanContext = exports.setSpanContext = exports.deleteSpan = exports.setSpan = exports.getActiveSpan = exports.getSpan = void 0;
    var context_1 = require_context();
    var NonRecordingSpan_1 = require_NonRecordingSpan();
    var context_2 = require_context2();
    var SPAN_KEY = (0, context_1.createContextKey)("OpenTelemetry Context Key SPAN");
    function getSpan(context4) {
      return context4.getValue(SPAN_KEY) || void 0;
    }
    __name(getSpan, "getSpan");
    exports.getSpan = getSpan;
    function getActiveSpan() {
      return getSpan(context_2.ContextAPI.getInstance().active());
    }
    __name(getActiveSpan, "getActiveSpan");
    exports.getActiveSpan = getActiveSpan;
    function setSpan(context4, span) {
      return context4.setValue(SPAN_KEY, span);
    }
    __name(setSpan, "setSpan");
    exports.setSpan = setSpan;
    function deleteSpan(context4) {
      return context4.deleteValue(SPAN_KEY);
    }
    __name(deleteSpan, "deleteSpan");
    exports.deleteSpan = deleteSpan;
    function setSpanContext(context4, spanContext) {
      return setSpan(context4, new NonRecordingSpan_1.NonRecordingSpan(spanContext));
    }
    __name(setSpanContext, "setSpanContext");
    exports.setSpanContext = setSpanContext;
    function getSpanContext(context4) {
      var _a;
      return (_a = getSpan(context4)) === null || _a === void 0 ? void 0 : _a.spanContext();
    }
    __name(getSpanContext, "getSpanContext");
    exports.getSpanContext = getSpanContext;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/spancontext-utils.js
var require_spancontext_utils = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/spancontext-utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wrapSpanContext = exports.isSpanContextValid = exports.isValidSpanId = exports.isValidTraceId = void 0;
    var invalid_span_constants_1 = require_invalid_span_constants();
    var NonRecordingSpan_1 = require_NonRecordingSpan();
    var VALID_TRACEID_REGEX = /^([0-9a-f]{32})$/i;
    var VALID_SPANID_REGEX = /^[0-9a-f]{16}$/i;
    function isValidTraceId(traceId) {
      return VALID_TRACEID_REGEX.test(traceId) && traceId !== invalid_span_constants_1.INVALID_TRACEID;
    }
    __name(isValidTraceId, "isValidTraceId");
    exports.isValidTraceId = isValidTraceId;
    function isValidSpanId(spanId) {
      return VALID_SPANID_REGEX.test(spanId) && spanId !== invalid_span_constants_1.INVALID_SPANID;
    }
    __name(isValidSpanId, "isValidSpanId");
    exports.isValidSpanId = isValidSpanId;
    function isSpanContextValid2(spanContext) {
      return isValidTraceId(spanContext.traceId) && isValidSpanId(spanContext.spanId);
    }
    __name(isSpanContextValid2, "isSpanContextValid");
    exports.isSpanContextValid = isSpanContextValid2;
    function wrapSpanContext(spanContext) {
      return new NonRecordingSpan_1.NonRecordingSpan(spanContext);
    }
    __name(wrapSpanContext, "wrapSpanContext");
    exports.wrapSpanContext = wrapSpanContext;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NoopTracer.js
var require_NoopTracer = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NoopTracer.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoopTracer = void 0;
    var context_1 = require_context2();
    var context_utils_1 = require_context_utils();
    var NonRecordingSpan_1 = require_NonRecordingSpan();
    var spancontext_utils_1 = require_spancontext_utils();
    var contextApi = context_1.ContextAPI.getInstance();
    var NoopTracer = class {
      static {
        __name(this, "NoopTracer");
      }
      // startSpan starts a noop span.
      startSpan(name, options, context4 = contextApi.active()) {
        const root = Boolean(options === null || options === void 0 ? void 0 : options.root);
        if (root) {
          return new NonRecordingSpan_1.NonRecordingSpan();
        }
        const parentFromContext = context4 && (0, context_utils_1.getSpanContext)(context4);
        if (isSpanContext(parentFromContext) && (0, spancontext_utils_1.isSpanContextValid)(parentFromContext)) {
          return new NonRecordingSpan_1.NonRecordingSpan(parentFromContext);
        } else {
          return new NonRecordingSpan_1.NonRecordingSpan();
        }
      }
      startActiveSpan(name, arg2, arg3, arg4) {
        let opts;
        let ctx;
        let fn;
        if (arguments.length < 2) {
          return;
        } else if (arguments.length === 2) {
          fn = arg2;
        } else if (arguments.length === 3) {
          opts = arg2;
          fn = arg3;
        } else {
          opts = arg2;
          ctx = arg3;
          fn = arg4;
        }
        const parentContext = ctx !== null && ctx !== void 0 ? ctx : contextApi.active();
        const span = this.startSpan(name, opts, parentContext);
        const contextWithSpanSet = (0, context_utils_1.setSpan)(parentContext, span);
        return contextApi.with(contextWithSpanSet, fn, void 0, span);
      }
    };
    exports.NoopTracer = NoopTracer;
    function isSpanContext(spanContext) {
      return typeof spanContext === "object" && typeof spanContext["spanId"] === "string" && typeof spanContext["traceId"] === "string" && typeof spanContext["traceFlags"] === "number";
    }
    __name(isSpanContext, "isSpanContext");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/ProxyTracer.js
var require_ProxyTracer = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/ProxyTracer.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProxyTracer = void 0;
    var NoopTracer_1 = require_NoopTracer();
    var NOOP_TRACER = new NoopTracer_1.NoopTracer();
    var ProxyTracer = class {
      static {
        __name(this, "ProxyTracer");
      }
      constructor(_provider, name, version2, options) {
        this._provider = _provider;
        this.name = name;
        this.version = version2;
        this.options = options;
      }
      startSpan(name, options, context4) {
        return this._getTracer().startSpan(name, options, context4);
      }
      startActiveSpan(_name, _options, _context, _fn) {
        const tracer = this._getTracer();
        return Reflect.apply(tracer.startActiveSpan, tracer, arguments);
      }
      /**
       * Try to get a tracer from the proxy tracer provider.
       * If the proxy tracer provider has no delegate, return a noop tracer.
       */
      _getTracer() {
        if (this._delegate) {
          return this._delegate;
        }
        const tracer = this._provider.getDelegateTracer(this.name, this.version, this.options);
        if (!tracer) {
          return NOOP_TRACER;
        }
        this._delegate = tracer;
        return this._delegate;
      }
    };
    exports.ProxyTracer = ProxyTracer;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NoopTracerProvider.js
var require_NoopTracerProvider = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/NoopTracerProvider.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoopTracerProvider = void 0;
    var NoopTracer_1 = require_NoopTracer();
    var NoopTracerProvider = class {
      static {
        __name(this, "NoopTracerProvider");
      }
      getTracer(_name, _version, _options) {
        return new NoopTracer_1.NoopTracer();
      }
    };
    exports.NoopTracerProvider = NoopTracerProvider;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/ProxyTracerProvider.js
var require_ProxyTracerProvider = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/ProxyTracerProvider.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProxyTracerProvider = void 0;
    var ProxyTracer_1 = require_ProxyTracer();
    var NoopTracerProvider_1 = require_NoopTracerProvider();
    var NOOP_TRACER_PROVIDER = new NoopTracerProvider_1.NoopTracerProvider();
    var ProxyTracerProvider = class {
      static {
        __name(this, "ProxyTracerProvider");
      }
      /**
       * Get a {@link ProxyTracer}
       */
      getTracer(name, version2, options) {
        var _a;
        return (_a = this.getDelegateTracer(name, version2, options)) !== null && _a !== void 0 ? _a : new ProxyTracer_1.ProxyTracer(this, name, version2, options);
      }
      getDelegate() {
        var _a;
        return (_a = this._delegate) !== null && _a !== void 0 ? _a : NOOP_TRACER_PROVIDER;
      }
      /**
       * Set the delegate tracer provider
       */
      setDelegate(delegate) {
        this._delegate = delegate;
      }
      getDelegateTracer(name, version2, options) {
        var _a;
        return (_a = this._delegate) === null || _a === void 0 ? void 0 : _a.getTracer(name, version2, options);
      }
    };
    exports.ProxyTracerProvider = ProxyTracerProvider;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/SamplingResult.js
var require_SamplingResult = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/SamplingResult.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SamplingDecision = void 0;
    var SamplingDecision2;
    (function(SamplingDecision3) {
      SamplingDecision3[SamplingDecision3["NOT_RECORD"] = 0] = "NOT_RECORD";
      SamplingDecision3[SamplingDecision3["RECORD"] = 1] = "RECORD";
      SamplingDecision3[SamplingDecision3["RECORD_AND_SAMPLED"] = 2] = "RECORD_AND_SAMPLED";
    })(SamplingDecision2 = exports.SamplingDecision || (exports.SamplingDecision = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/span_kind.js
var require_span_kind = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/span_kind.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SpanKind = void 0;
    var SpanKind2;
    (function(SpanKind3) {
      SpanKind3[SpanKind3["INTERNAL"] = 0] = "INTERNAL";
      SpanKind3[SpanKind3["SERVER"] = 1] = "SERVER";
      SpanKind3[SpanKind3["CLIENT"] = 2] = "CLIENT";
      SpanKind3[SpanKind3["PRODUCER"] = 3] = "PRODUCER";
      SpanKind3[SpanKind3["CONSUMER"] = 4] = "CONSUMER";
    })(SpanKind2 = exports.SpanKind || (exports.SpanKind = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/status.js
var require_status = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/status.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SpanStatusCode = void 0;
    var SpanStatusCode2;
    (function(SpanStatusCode3) {
      SpanStatusCode3[SpanStatusCode3["UNSET"] = 0] = "UNSET";
      SpanStatusCode3[SpanStatusCode3["OK"] = 1] = "OK";
      SpanStatusCode3[SpanStatusCode3["ERROR"] = 2] = "ERROR";
    })(SpanStatusCode2 = exports.SpanStatusCode || (exports.SpanStatusCode = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-validators.js
var require_tracestate_validators = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-validators.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateValue = exports.validateKey = void 0;
    var VALID_KEY_CHAR_RANGE = "[_0-9a-z-*/]";
    var VALID_KEY = `[a-z]${VALID_KEY_CHAR_RANGE}{0,255}`;
    var VALID_VENDOR_KEY = `[a-z0-9]${VALID_KEY_CHAR_RANGE}{0,240}@[a-z]${VALID_KEY_CHAR_RANGE}{0,13}`;
    var VALID_KEY_REGEX = new RegExp(`^(?:${VALID_KEY}|${VALID_VENDOR_KEY})$`);
    var VALID_VALUE_BASE_REGEX = /^[ -~]{0,255}[!-~]$/;
    var INVALID_VALUE_COMMA_EQUAL_REGEX = /,|=/;
    function validateKey(key) {
      return VALID_KEY_REGEX.test(key);
    }
    __name(validateKey, "validateKey");
    exports.validateKey = validateKey;
    function validateValue(value) {
      return VALID_VALUE_BASE_REGEX.test(value) && !INVALID_VALUE_COMMA_EQUAL_REGEX.test(value);
    }
    __name(validateValue, "validateValue");
    exports.validateValue = validateValue;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-impl.js
var require_tracestate_impl = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-impl.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TraceStateImpl = void 0;
    var tracestate_validators_1 = require_tracestate_validators();
    var MAX_TRACE_STATE_ITEMS = 32;
    var MAX_TRACE_STATE_LEN = 512;
    var LIST_MEMBERS_SEPARATOR = ",";
    var LIST_MEMBER_KEY_VALUE_SPLITTER = "=";
    var TraceStateImpl = class _TraceStateImpl {
      static {
        __name(this, "TraceStateImpl");
      }
      constructor(rawTraceState) {
        this._internalState = /* @__PURE__ */ new Map();
        if (rawTraceState)
          this._parse(rawTraceState);
      }
      set(key, value) {
        const traceState = this._clone();
        if (traceState._internalState.has(key)) {
          traceState._internalState.delete(key);
        }
        traceState._internalState.set(key, value);
        return traceState;
      }
      unset(key) {
        const traceState = this._clone();
        traceState._internalState.delete(key);
        return traceState;
      }
      get(key) {
        return this._internalState.get(key);
      }
      serialize() {
        return this._keys().reduce((agg, key) => {
          agg.push(key + LIST_MEMBER_KEY_VALUE_SPLITTER + this.get(key));
          return agg;
        }, []).join(LIST_MEMBERS_SEPARATOR);
      }
      _parse(rawTraceState) {
        if (rawTraceState.length > MAX_TRACE_STATE_LEN)
          return;
        this._internalState = rawTraceState.split(LIST_MEMBERS_SEPARATOR).reverse().reduce((agg, part) => {
          const listMember = part.trim();
          const i = listMember.indexOf(LIST_MEMBER_KEY_VALUE_SPLITTER);
          if (i !== -1) {
            const key = listMember.slice(0, i);
            const value = listMember.slice(i + 1, part.length);
            if ((0, tracestate_validators_1.validateKey)(key) && (0, tracestate_validators_1.validateValue)(value)) {
              agg.set(key, value);
            } else {
            }
          }
          return agg;
        }, /* @__PURE__ */ new Map());
        if (this._internalState.size > MAX_TRACE_STATE_ITEMS) {
          this._internalState = new Map(Array.from(this._internalState.entries()).reverse().slice(0, MAX_TRACE_STATE_ITEMS));
        }
      }
      _keys() {
        return Array.from(this._internalState.keys()).reverse();
      }
      _clone() {
        const traceState = new _TraceStateImpl();
        traceState._internalState = new Map(this._internalState);
        return traceState;
      }
    };
    exports.TraceStateImpl = TraceStateImpl;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/utils.js
var require_utils2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace/internal/utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createTraceState = void 0;
    var tracestate_impl_1 = require_tracestate_impl();
    function createTraceState(rawTraceState) {
      return new tracestate_impl_1.TraceStateImpl(rawTraceState);
    }
    __name(createTraceState, "createTraceState");
    exports.createTraceState = createTraceState;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context-api.js
var require_context_api = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/context-api.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.context = void 0;
    var context_1 = require_context2();
    exports.context = context_1.ContextAPI.getInstance();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag-api.js
var require_diag_api = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/diag-api.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.diag = void 0;
    var diag_1 = require_diag();
    exports.diag = diag_1.DiagAPI.instance();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/NoopMeterProvider.js
var require_NoopMeterProvider = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics/NoopMeterProvider.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NOOP_METER_PROVIDER = exports.NoopMeterProvider = void 0;
    var NoopMeter_1 = require_NoopMeter();
    var NoopMeterProvider = class {
      static {
        __name(this, "NoopMeterProvider");
      }
      getMeter(_name, _version, _options) {
        return NoopMeter_1.NOOP_METER;
      }
    };
    exports.NoopMeterProvider = NoopMeterProvider;
    exports.NOOP_METER_PROVIDER = new NoopMeterProvider();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/metrics.js
var require_metrics = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/metrics.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MetricsAPI = void 0;
    var NoopMeterProvider_1 = require_NoopMeterProvider();
    var global_utils_1 = require_global_utils();
    var diag_1 = require_diag();
    var API_NAME = "metrics";
    var MetricsAPI = class _MetricsAPI {
      static {
        __name(this, "MetricsAPI");
      }
      /** Empty private constructor prevents end users from constructing a new instance of the API */
      constructor() {
      }
      /** Get the singleton instance of the Metrics API */
      static getInstance() {
        if (!this._instance) {
          this._instance = new _MetricsAPI();
        }
        return this._instance;
      }
      /**
       * Set the current global meter provider.
       * Returns true if the meter provider was successfully registered, else false.
       */
      setGlobalMeterProvider(provider) {
        return (0, global_utils_1.registerGlobal)(API_NAME, provider, diag_1.DiagAPI.instance());
      }
      /**
       * Returns the global meter provider.
       */
      getMeterProvider() {
        return (0, global_utils_1.getGlobal)(API_NAME) || NoopMeterProvider_1.NOOP_METER_PROVIDER;
      }
      /**
       * Returns a meter from the global meter provider.
       */
      getMeter(name, version2, options) {
        return this.getMeterProvider().getMeter(name, version2, options);
      }
      /** Remove the global meter provider */
      disable() {
        (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
      }
    };
    exports.MetricsAPI = MetricsAPI;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics-api.js
var require_metrics_api = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/metrics-api.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.metrics = void 0;
    var metrics_1 = require_metrics();
    exports.metrics = metrics_1.MetricsAPI.getInstance();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation/NoopTextMapPropagator.js
var require_NoopTextMapPropagator = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation/NoopTextMapPropagator.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NoopTextMapPropagator = void 0;
    var NoopTextMapPropagator = class {
      static {
        __name(this, "NoopTextMapPropagator");
      }
      /** Noop inject function does nothing */
      inject(_context, _carrier) {
      }
      /** Noop extract function does nothing and returns the input context */
      extract(context4, _carrier) {
        return context4;
      }
      fields() {
        return [];
      }
    };
    exports.NoopTextMapPropagator = NoopTextMapPropagator;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/context-helpers.js
var require_context_helpers = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/baggage/context-helpers.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.deleteBaggage = exports.setBaggage = exports.getActiveBaggage = exports.getBaggage = void 0;
    var context_1 = require_context2();
    var context_2 = require_context();
    var BAGGAGE_KEY = (0, context_2.createContextKey)("OpenTelemetry Baggage Key");
    function getBaggage(context4) {
      return context4.getValue(BAGGAGE_KEY) || void 0;
    }
    __name(getBaggage, "getBaggage");
    exports.getBaggage = getBaggage;
    function getActiveBaggage() {
      return getBaggage(context_1.ContextAPI.getInstance().active());
    }
    __name(getActiveBaggage, "getActiveBaggage");
    exports.getActiveBaggage = getActiveBaggage;
    function setBaggage(context4, baggage) {
      return context4.setValue(BAGGAGE_KEY, baggage);
    }
    __name(setBaggage, "setBaggage");
    exports.setBaggage = setBaggage;
    function deleteBaggage(context4) {
      return context4.deleteValue(BAGGAGE_KEY);
    }
    __name(deleteBaggage, "deleteBaggage");
    exports.deleteBaggage = deleteBaggage;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/propagation.js
var require_propagation = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/propagation.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PropagationAPI = void 0;
    var global_utils_1 = require_global_utils();
    var NoopTextMapPropagator_1 = require_NoopTextMapPropagator();
    var TextMapPropagator_1 = require_TextMapPropagator();
    var context_helpers_1 = require_context_helpers();
    var utils_1 = require_utils();
    var diag_1 = require_diag();
    var API_NAME = "propagation";
    var NOOP_TEXT_MAP_PROPAGATOR = new NoopTextMapPropagator_1.NoopTextMapPropagator();
    var PropagationAPI = class _PropagationAPI {
      static {
        __name(this, "PropagationAPI");
      }
      /** Empty private constructor prevents end users from constructing a new instance of the API */
      constructor() {
        this.createBaggage = utils_1.createBaggage;
        this.getBaggage = context_helpers_1.getBaggage;
        this.getActiveBaggage = context_helpers_1.getActiveBaggage;
        this.setBaggage = context_helpers_1.setBaggage;
        this.deleteBaggage = context_helpers_1.deleteBaggage;
      }
      /** Get the singleton instance of the Propagator API */
      static getInstance() {
        if (!this._instance) {
          this._instance = new _PropagationAPI();
        }
        return this._instance;
      }
      /**
       * Set the current propagator.
       *
       * @returns true if the propagator was successfully registered, else false
       */
      setGlobalPropagator(propagator) {
        return (0, global_utils_1.registerGlobal)(API_NAME, propagator, diag_1.DiagAPI.instance());
      }
      /**
       * Inject context into a carrier to be propagated inter-process
       *
       * @param context Context carrying tracing data to inject
       * @param carrier carrier to inject context into
       * @param setter Function used to set values on the carrier
       */
      inject(context4, carrier, setter = TextMapPropagator_1.defaultTextMapSetter) {
        return this._getGlobalPropagator().inject(context4, carrier, setter);
      }
      /**
       * Extract context from a carrier
       *
       * @param context Context which the newly created context will inherit from
       * @param carrier Carrier to extract context from
       * @param getter Function used to extract keys from a carrier
       */
      extract(context4, carrier, getter = TextMapPropagator_1.defaultTextMapGetter) {
        return this._getGlobalPropagator().extract(context4, carrier, getter);
      }
      /**
       * Return a list of all fields which may be used by the propagator.
       */
      fields() {
        return this._getGlobalPropagator().fields();
      }
      /** Remove the global propagator */
      disable() {
        (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
      }
      _getGlobalPropagator() {
        return (0, global_utils_1.getGlobal)(API_NAME) || NOOP_TEXT_MAP_PROPAGATOR;
      }
    };
    exports.PropagationAPI = PropagationAPI;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation-api.js
var require_propagation_api = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/propagation-api.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.propagation = void 0;
    var propagation_1 = require_propagation();
    exports.propagation = propagation_1.PropagationAPI.getInstance();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/trace.js
var require_trace = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/api/trace.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TraceAPI = void 0;
    var global_utils_1 = require_global_utils();
    var ProxyTracerProvider_1 = require_ProxyTracerProvider();
    var spancontext_utils_1 = require_spancontext_utils();
    var context_utils_1 = require_context_utils();
    var diag_1 = require_diag();
    var API_NAME = "trace";
    var TraceAPI = class _TraceAPI {
      static {
        __name(this, "TraceAPI");
      }
      /** Empty private constructor prevents end users from constructing a new instance of the API */
      constructor() {
        this._proxyTracerProvider = new ProxyTracerProvider_1.ProxyTracerProvider();
        this.wrapSpanContext = spancontext_utils_1.wrapSpanContext;
        this.isSpanContextValid = spancontext_utils_1.isSpanContextValid;
        this.deleteSpan = context_utils_1.deleteSpan;
        this.getSpan = context_utils_1.getSpan;
        this.getActiveSpan = context_utils_1.getActiveSpan;
        this.getSpanContext = context_utils_1.getSpanContext;
        this.setSpan = context_utils_1.setSpan;
        this.setSpanContext = context_utils_1.setSpanContext;
      }
      /** Get the singleton instance of the Trace API */
      static getInstance() {
        if (!this._instance) {
          this._instance = new _TraceAPI();
        }
        return this._instance;
      }
      /**
       * Set the current global tracer.
       *
       * @returns true if the tracer provider was successfully registered, else false
       */
      setGlobalTracerProvider(provider) {
        const success = (0, global_utils_1.registerGlobal)(API_NAME, this._proxyTracerProvider, diag_1.DiagAPI.instance());
        if (success) {
          this._proxyTracerProvider.setDelegate(provider);
        }
        return success;
      }
      /**
       * Returns the global tracer provider.
       */
      getTracerProvider() {
        return (0, global_utils_1.getGlobal)(API_NAME) || this._proxyTracerProvider;
      }
      /**
       * Returns a tracer from the global tracer provider.
       */
      getTracer(name, version2) {
        return this.getTracerProvider().getTracer(name, version2);
      }
      /** Remove the global tracer provider */
      disable() {
        (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
        this._proxyTracerProvider = new ProxyTracerProvider_1.ProxyTracerProvider();
      }
    };
    exports.TraceAPI = TraceAPI;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace-api.js
var require_trace_api = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/trace-api.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.trace = void 0;
    var trace_1 = require_trace();
    exports.trace = trace_1.TraceAPI.getInstance();
  }
});

// ../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/index.js
var require_src = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/src/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.trace = exports.propagation = exports.metrics = exports.diag = exports.context = exports.INVALID_SPAN_CONTEXT = exports.INVALID_TRACEID = exports.INVALID_SPANID = exports.isValidSpanId = exports.isValidTraceId = exports.isSpanContextValid = exports.createTraceState = exports.TraceFlags = exports.SpanStatusCode = exports.SpanKind = exports.SamplingDecision = exports.ProxyTracerProvider = exports.ProxyTracer = exports.defaultTextMapSetter = exports.defaultTextMapGetter = exports.ValueType = exports.createNoopMeter = exports.DiagLogLevel = exports.DiagConsoleLogger = exports.ROOT_CONTEXT = exports.createContextKey = exports.baggageEntryMetadataFromString = void 0;
    var utils_1 = require_utils();
    Object.defineProperty(exports, "baggageEntryMetadataFromString", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return utils_1.baggageEntryMetadataFromString;
    }, "get") });
    var context_1 = require_context();
    Object.defineProperty(exports, "createContextKey", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return context_1.createContextKey;
    }, "get") });
    Object.defineProperty(exports, "ROOT_CONTEXT", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return context_1.ROOT_CONTEXT;
    }, "get") });
    var consoleLogger_1 = require_consoleLogger();
    Object.defineProperty(exports, "DiagConsoleLogger", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return consoleLogger_1.DiagConsoleLogger;
    }, "get") });
    var types_1 = require_types();
    Object.defineProperty(exports, "DiagLogLevel", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return types_1.DiagLogLevel;
    }, "get") });
    var NoopMeter_1 = require_NoopMeter();
    Object.defineProperty(exports, "createNoopMeter", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return NoopMeter_1.createNoopMeter;
    }, "get") });
    var Metric_1 = require_Metric();
    Object.defineProperty(exports, "ValueType", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return Metric_1.ValueType;
    }, "get") });
    var TextMapPropagator_1 = require_TextMapPropagator();
    Object.defineProperty(exports, "defaultTextMapGetter", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return TextMapPropagator_1.defaultTextMapGetter;
    }, "get") });
    Object.defineProperty(exports, "defaultTextMapSetter", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return TextMapPropagator_1.defaultTextMapSetter;
    }, "get") });
    var ProxyTracer_1 = require_ProxyTracer();
    Object.defineProperty(exports, "ProxyTracer", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return ProxyTracer_1.ProxyTracer;
    }, "get") });
    var ProxyTracerProvider_1 = require_ProxyTracerProvider();
    Object.defineProperty(exports, "ProxyTracerProvider", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return ProxyTracerProvider_1.ProxyTracerProvider;
    }, "get") });
    var SamplingResult_1 = require_SamplingResult();
    Object.defineProperty(exports, "SamplingDecision", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return SamplingResult_1.SamplingDecision;
    }, "get") });
    var span_kind_1 = require_span_kind();
    Object.defineProperty(exports, "SpanKind", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return span_kind_1.SpanKind;
    }, "get") });
    var status_1 = require_status();
    Object.defineProperty(exports, "SpanStatusCode", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return status_1.SpanStatusCode;
    }, "get") });
    var trace_flags_1 = require_trace_flags();
    Object.defineProperty(exports, "TraceFlags", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return trace_flags_1.TraceFlags;
    }, "get") });
    var utils_2 = require_utils2();
    Object.defineProperty(exports, "createTraceState", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return utils_2.createTraceState;
    }, "get") });
    var spancontext_utils_1 = require_spancontext_utils();
    Object.defineProperty(exports, "isSpanContextValid", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return spancontext_utils_1.isSpanContextValid;
    }, "get") });
    Object.defineProperty(exports, "isValidTraceId", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return spancontext_utils_1.isValidTraceId;
    }, "get") });
    Object.defineProperty(exports, "isValidSpanId", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return spancontext_utils_1.isValidSpanId;
    }, "get") });
    var invalid_span_constants_1 = require_invalid_span_constants();
    Object.defineProperty(exports, "INVALID_SPANID", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return invalid_span_constants_1.INVALID_SPANID;
    }, "get") });
    Object.defineProperty(exports, "INVALID_TRACEID", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return invalid_span_constants_1.INVALID_TRACEID;
    }, "get") });
    Object.defineProperty(exports, "INVALID_SPAN_CONTEXT", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return invalid_span_constants_1.INVALID_SPAN_CONTEXT;
    }, "get") });
    var context_api_1 = require_context_api();
    Object.defineProperty(exports, "context", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return context_api_1.context;
    }, "get") });
    var diag_api_1 = require_diag_api();
    Object.defineProperty(exports, "diag", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return diag_api_1.diag;
    }, "get") });
    var metrics_api_1 = require_metrics_api();
    Object.defineProperty(exports, "metrics", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return metrics_api_1.metrics;
    }, "get") });
    var propagation_api_1 = require_propagation_api();
    Object.defineProperty(exports, "propagation", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return propagation_api_1.propagation;
    }, "get") });
    var trace_api_1 = require_trace_api();
    Object.defineProperty(exports, "trace", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return trace_api_1.trace;
    }, "get") });
    exports.default = {
      context: context_api_1.context,
      diag: diag_api_1.diag,
      metrics: metrics_api_1.metrics,
      propagation: propagation_api_1.propagation,
      trace: trace_api_1.trace
    };
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/suppress-tracing.js
var require_suppress_tracing = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/suppress-tracing.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isTracingSuppressed = exports.unsuppressTracing = exports.suppressTracing = void 0;
    var api_1 = require_src();
    var SUPPRESS_TRACING_KEY = (0, api_1.createContextKey)("OpenTelemetry SDK Context Key SUPPRESS_TRACING");
    function suppressTracing(context4) {
      return context4.setValue(SUPPRESS_TRACING_KEY, true);
    }
    __name(suppressTracing, "suppressTracing");
    exports.suppressTracing = suppressTracing;
    function unsuppressTracing(context4) {
      return context4.deleteValue(SUPPRESS_TRACING_KEY);
    }
    __name(unsuppressTracing, "unsuppressTracing");
    exports.unsuppressTracing = unsuppressTracing;
    function isTracingSuppressed(context4) {
      return context4.getValue(SUPPRESS_TRACING_KEY) === true;
    }
    __name(isTracingSuppressed, "isTracingSuppressed");
    exports.isTracingSuppressed = isTracingSuppressed;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/constants.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BAGGAGE_MAX_TOTAL_LENGTH = exports.BAGGAGE_MAX_PER_NAME_VALUE_PAIRS = exports.BAGGAGE_MAX_NAME_VALUE_PAIRS = exports.BAGGAGE_HEADER = exports.BAGGAGE_ITEMS_SEPARATOR = exports.BAGGAGE_PROPERTIES_SEPARATOR = exports.BAGGAGE_KEY_PAIR_SEPARATOR = void 0;
    exports.BAGGAGE_KEY_PAIR_SEPARATOR = "=";
    exports.BAGGAGE_PROPERTIES_SEPARATOR = ";";
    exports.BAGGAGE_ITEMS_SEPARATOR = ",";
    exports.BAGGAGE_HEADER = "baggage";
    exports.BAGGAGE_MAX_NAME_VALUE_PAIRS = 180;
    exports.BAGGAGE_MAX_PER_NAME_VALUE_PAIRS = 4096;
    exports.BAGGAGE_MAX_TOTAL_LENGTH = 8192;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/utils.js
var require_utils3 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseKeyPairsIntoRecord = exports.parsePairKeyValue = exports.getKeyPairs = exports.serializeKeyPairs = void 0;
    var api_1 = require_src();
    var constants_1 = require_constants();
    function serializeKeyPairs(keyPairs) {
      return keyPairs.reduce((hValue, current) => {
        const value = `${hValue}${hValue !== "" ? constants_1.BAGGAGE_ITEMS_SEPARATOR : ""}${current}`;
        return value.length > constants_1.BAGGAGE_MAX_TOTAL_LENGTH ? hValue : value;
      }, "");
    }
    __name(serializeKeyPairs, "serializeKeyPairs");
    exports.serializeKeyPairs = serializeKeyPairs;
    function getKeyPairs(baggage) {
      return baggage.getAllEntries().map(([key, value]) => {
        let entry = `${encodeURIComponent(key)}=${encodeURIComponent(value.value)}`;
        if (value.metadata !== void 0) {
          entry += constants_1.BAGGAGE_PROPERTIES_SEPARATOR + value.metadata.toString();
        }
        return entry;
      });
    }
    __name(getKeyPairs, "getKeyPairs");
    exports.getKeyPairs = getKeyPairs;
    function parsePairKeyValue(entry) {
      const valueProps = entry.split(constants_1.BAGGAGE_PROPERTIES_SEPARATOR);
      if (valueProps.length <= 0)
        return;
      const keyPairPart = valueProps.shift();
      if (!keyPairPart)
        return;
      const separatorIndex = keyPairPart.indexOf(constants_1.BAGGAGE_KEY_PAIR_SEPARATOR);
      if (separatorIndex <= 0)
        return;
      const key = decodeURIComponent(keyPairPart.substring(0, separatorIndex).trim());
      const value = decodeURIComponent(keyPairPart.substring(separatorIndex + 1).trim());
      let metadata;
      if (valueProps.length > 0) {
        metadata = (0, api_1.baggageEntryMetadataFromString)(valueProps.join(constants_1.BAGGAGE_PROPERTIES_SEPARATOR));
      }
      return { key, value, metadata };
    }
    __name(parsePairKeyValue, "parsePairKeyValue");
    exports.parsePairKeyValue = parsePairKeyValue;
    function parseKeyPairsIntoRecord(value) {
      const result = {};
      if (typeof value === "string" && value.length > 0) {
        value.split(constants_1.BAGGAGE_ITEMS_SEPARATOR).forEach((entry) => {
          const keyPair = parsePairKeyValue(entry);
          if (keyPair !== void 0 && keyPair.value.length > 0) {
            result[keyPair.key] = keyPair.value;
          }
        });
      }
      return result;
    }
    __name(parseKeyPairsIntoRecord, "parseKeyPairsIntoRecord");
    exports.parseKeyPairsIntoRecord = parseKeyPairsIntoRecord;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/propagation/W3CBaggagePropagator.js
var require_W3CBaggagePropagator = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/baggage/propagation/W3CBaggagePropagator.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.W3CBaggagePropagator = void 0;
    var api_1 = require_src();
    var suppress_tracing_1 = require_suppress_tracing();
    var constants_1 = require_constants();
    var utils_1 = require_utils3();
    var W3CBaggagePropagator = class {
      static {
        __name(this, "W3CBaggagePropagator");
      }
      inject(context4, carrier, setter) {
        const baggage = api_1.propagation.getBaggage(context4);
        if (!baggage || (0, suppress_tracing_1.isTracingSuppressed)(context4))
          return;
        const keyPairs = (0, utils_1.getKeyPairs)(baggage).filter((pair) => {
          return pair.length <= constants_1.BAGGAGE_MAX_PER_NAME_VALUE_PAIRS;
        }).slice(0, constants_1.BAGGAGE_MAX_NAME_VALUE_PAIRS);
        const headerValue = (0, utils_1.serializeKeyPairs)(keyPairs);
        if (headerValue.length > 0) {
          setter.set(carrier, constants_1.BAGGAGE_HEADER, headerValue);
        }
      }
      extract(context4, carrier, getter) {
        const headerValue = getter.get(carrier, constants_1.BAGGAGE_HEADER);
        const baggageString = Array.isArray(headerValue) ? headerValue.join(constants_1.BAGGAGE_ITEMS_SEPARATOR) : headerValue;
        if (!baggageString)
          return context4;
        const baggage = {};
        if (baggageString.length === 0) {
          return context4;
        }
        const pairs = baggageString.split(constants_1.BAGGAGE_ITEMS_SEPARATOR);
        pairs.forEach((entry) => {
          const keyPair = (0, utils_1.parsePairKeyValue)(entry);
          if (keyPair) {
            const baggageEntry = { value: keyPair.value };
            if (keyPair.metadata) {
              baggageEntry.metadata = keyPair.metadata;
            }
            baggage[keyPair.key] = baggageEntry;
          }
        });
        if (Object.entries(baggage).length === 0) {
          return context4;
        }
        return api_1.propagation.setBaggage(context4, api_1.propagation.createBaggage(baggage));
      }
      fields() {
        return [constants_1.BAGGAGE_HEADER];
      }
    };
    exports.W3CBaggagePropagator = W3CBaggagePropagator;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/anchored-clock.js
var require_anchored_clock = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/anchored-clock.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AnchoredClock = void 0;
    var AnchoredClock = class {
      static {
        __name(this, "AnchoredClock");
      }
      _monotonicClock;
      _epochMillis;
      _performanceMillis;
      /**
       * Create a new AnchoredClock anchored to the current time returned by systemClock.
       *
       * @param systemClock should be a clock that returns the number of milliseconds since January 1 1970 such as Date
       * @param monotonicClock should be a clock that counts milliseconds monotonically such as window.performance or perf_hooks.performance
       */
      constructor(systemClock, monotonicClock) {
        this._monotonicClock = monotonicClock;
        this._epochMillis = systemClock.now();
        this._performanceMillis = monotonicClock.now();
      }
      /**
       * Returns the current time by adding the number of milliseconds since the
       * AnchoredClock was created to the creation epoch time
       */
      now() {
        const delta = this._monotonicClock.now() - this._performanceMillis;
        return this._epochMillis + delta;
      }
    };
    exports.AnchoredClock = AnchoredClock;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/attributes.js
var require_attributes = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/attributes.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isAttributeValue = exports.isAttributeKey = exports.sanitizeAttributes = void 0;
    var api_1 = require_src();
    function sanitizeAttributes(attributes) {
      const out = {};
      if (typeof attributes !== "object" || attributes == null) {
        return out;
      }
      for (const key in attributes) {
        if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
          continue;
        }
        if (!isAttributeKey(key)) {
          api_1.diag.warn(`Invalid attribute key: ${key}`);
          continue;
        }
        const val = attributes[key];
        if (!isAttributeValue(val)) {
          api_1.diag.warn(`Invalid attribute value set for key: ${key}`);
          continue;
        }
        if (Array.isArray(val)) {
          out[key] = val.slice();
        } else {
          out[key] = val;
        }
      }
      return out;
    }
    __name(sanitizeAttributes, "sanitizeAttributes");
    exports.sanitizeAttributes = sanitizeAttributes;
    function isAttributeKey(key) {
      return typeof key === "string" && key !== "";
    }
    __name(isAttributeKey, "isAttributeKey");
    exports.isAttributeKey = isAttributeKey;
    function isAttributeValue(val) {
      if (val == null) {
        return true;
      }
      if (Array.isArray(val)) {
        return isHomogeneousAttributeValueArray(val);
      }
      return isValidPrimitiveAttributeValueType(typeof val);
    }
    __name(isAttributeValue, "isAttributeValue");
    exports.isAttributeValue = isAttributeValue;
    function isHomogeneousAttributeValueArray(arr) {
      let type;
      for (const element of arr) {
        if (element == null)
          continue;
        const elementType = typeof element;
        if (elementType === type) {
          continue;
        }
        if (!type) {
          if (isValidPrimitiveAttributeValueType(elementType)) {
            type = elementType;
            continue;
          }
          return false;
        }
        return false;
      }
      return true;
    }
    __name(isHomogeneousAttributeValueArray, "isHomogeneousAttributeValueArray");
    function isValidPrimitiveAttributeValueType(valType) {
      switch (valType) {
        case "number":
        case "boolean":
        case "string":
          return true;
      }
      return false;
    }
    __name(isValidPrimitiveAttributeValueType, "isValidPrimitiveAttributeValueType");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/logging-error-handler.js
var require_logging_error_handler = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/logging-error-handler.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.loggingErrorHandler = void 0;
    var api_1 = require_src();
    function loggingErrorHandler() {
      return (ex) => {
        api_1.diag.error(stringifyException(ex));
      };
    }
    __name(loggingErrorHandler, "loggingErrorHandler");
    exports.loggingErrorHandler = loggingErrorHandler;
    function stringifyException(ex) {
      if (typeof ex === "string") {
        return ex;
      } else {
        return JSON.stringify(flattenException(ex));
      }
    }
    __name(stringifyException, "stringifyException");
    function flattenException(ex) {
      const result = {};
      let current = ex;
      while (current !== null) {
        Object.getOwnPropertyNames(current).forEach((propertyName) => {
          if (result[propertyName])
            return;
          const value = current[propertyName];
          if (value) {
            result[propertyName] = String(value);
          }
        });
        current = Object.getPrototypeOf(current);
      }
      return result;
    }
    __name(flattenException, "flattenException");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/global-error-handler.js
var require_global_error_handler = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/global-error-handler.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.globalErrorHandler = exports.setGlobalErrorHandler = void 0;
    var logging_error_handler_1 = require_logging_error_handler();
    var delegateHandler = (0, logging_error_handler_1.loggingErrorHandler)();
    function setGlobalErrorHandler(handler2) {
      delegateHandler = handler2;
    }
    __name(setGlobalErrorHandler, "setGlobalErrorHandler");
    exports.setGlobalErrorHandler = setGlobalErrorHandler;
    function globalErrorHandler2(ex) {
      try {
        delegateHandler(ex);
      } catch {
      }
    }
    __name(globalErrorHandler2, "globalErrorHandler");
    exports.globalErrorHandler = globalErrorHandler2;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/environment.js
var require_environment = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/environment.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getStringListFromEnv = exports.getNumberFromEnv = exports.getBooleanFromEnv = exports.getStringFromEnv = void 0;
    function getStringFromEnv(_) {
      return void 0;
    }
    __name(getStringFromEnv, "getStringFromEnv");
    exports.getStringFromEnv = getStringFromEnv;
    function getBooleanFromEnv(_) {
      return void 0;
    }
    __name(getBooleanFromEnv, "getBooleanFromEnv");
    exports.getBooleanFromEnv = getBooleanFromEnv;
    function getNumberFromEnv(_) {
      return void 0;
    }
    __name(getNumberFromEnv, "getNumberFromEnv");
    exports.getNumberFromEnv = getNumberFromEnv;
    function getStringListFromEnv(_) {
      return void 0;
    }
    __name(getStringListFromEnv, "getStringListFromEnv");
    exports.getStringListFromEnv = getStringListFromEnv;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/globalThis.js
var require_globalThis2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/globalThis.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports._globalThis = void 0;
    exports._globalThis = typeof globalThis === "object" ? globalThis : typeof self === "object" ? self : typeof window === "object" ? window : typeof global === "object" ? global : {};
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/performance.js
var require_performance = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/performance.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.otperformance = void 0;
    exports.otperformance = performance;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/version.js
var require_version2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/version.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.VERSION = void 0;
    exports.VERSION = "2.2.0";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/internal/utils.js
var require_utils4 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/internal/utils.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createConstMap = void 0;
    // @__NO_SIDE_EFFECTS__
    function createConstMap(values) {
      let res = {};
      const len = values.length;
      for (let lp = 0; lp < len; lp++) {
        const val = values[lp];
        if (val) {
          res[String(val).toUpperCase().replace(/[-.]/g, "_")] = val;
        }
      }
      return res;
    }
    __name(createConstMap, "createConstMap");
    exports.createConstMap = createConstMap;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/trace/SemanticAttributes.js
var require_SemanticAttributes = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/trace/SemanticAttributes.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SEMATTRS_NET_HOST_CARRIER_ICC = exports.SEMATTRS_NET_HOST_CARRIER_MNC = exports.SEMATTRS_NET_HOST_CARRIER_MCC = exports.SEMATTRS_NET_HOST_CARRIER_NAME = exports.SEMATTRS_NET_HOST_CONNECTION_SUBTYPE = exports.SEMATTRS_NET_HOST_CONNECTION_TYPE = exports.SEMATTRS_NET_HOST_NAME = exports.SEMATTRS_NET_HOST_PORT = exports.SEMATTRS_NET_HOST_IP = exports.SEMATTRS_NET_PEER_NAME = exports.SEMATTRS_NET_PEER_PORT = exports.SEMATTRS_NET_PEER_IP = exports.SEMATTRS_NET_TRANSPORT = exports.SEMATTRS_FAAS_INVOKED_REGION = exports.SEMATTRS_FAAS_INVOKED_PROVIDER = exports.SEMATTRS_FAAS_INVOKED_NAME = exports.SEMATTRS_FAAS_COLDSTART = exports.SEMATTRS_FAAS_CRON = exports.SEMATTRS_FAAS_TIME = exports.SEMATTRS_FAAS_DOCUMENT_NAME = exports.SEMATTRS_FAAS_DOCUMENT_TIME = exports.SEMATTRS_FAAS_DOCUMENT_OPERATION = exports.SEMATTRS_FAAS_DOCUMENT_COLLECTION = exports.SEMATTRS_FAAS_EXECUTION = exports.SEMATTRS_FAAS_TRIGGER = exports.SEMATTRS_EXCEPTION_ESCAPED = exports.SEMATTRS_EXCEPTION_STACKTRACE = exports.SEMATTRS_EXCEPTION_MESSAGE = exports.SEMATTRS_EXCEPTION_TYPE = exports.SEMATTRS_DB_SQL_TABLE = exports.SEMATTRS_DB_MONGODB_COLLECTION = exports.SEMATTRS_DB_REDIS_DATABASE_INDEX = exports.SEMATTRS_DB_HBASE_NAMESPACE = exports.SEMATTRS_DB_CASSANDRA_COORDINATOR_DC = exports.SEMATTRS_DB_CASSANDRA_COORDINATOR_ID = exports.SEMATTRS_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = exports.SEMATTRS_DB_CASSANDRA_IDEMPOTENCE = exports.SEMATTRS_DB_CASSANDRA_TABLE = exports.SEMATTRS_DB_CASSANDRA_CONSISTENCY_LEVEL = exports.SEMATTRS_DB_CASSANDRA_PAGE_SIZE = exports.SEMATTRS_DB_CASSANDRA_KEYSPACE = exports.SEMATTRS_DB_MSSQL_INSTANCE_NAME = exports.SEMATTRS_DB_OPERATION = exports.SEMATTRS_DB_STATEMENT = exports.SEMATTRS_DB_NAME = exports.SEMATTRS_DB_JDBC_DRIVER_CLASSNAME = exports.SEMATTRS_DB_USER = exports.SEMATTRS_DB_CONNECTION_STRING = exports.SEMATTRS_DB_SYSTEM = exports.SEMATTRS_AWS_LAMBDA_INVOKED_ARN = void 0;
    exports.SEMATTRS_MESSAGING_DESTINATION_KIND = exports.SEMATTRS_MESSAGING_DESTINATION = exports.SEMATTRS_MESSAGING_SYSTEM = exports.SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = exports.SEMATTRS_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = exports.SEMATTRS_AWS_DYNAMODB_SCANNED_COUNT = exports.SEMATTRS_AWS_DYNAMODB_COUNT = exports.SEMATTRS_AWS_DYNAMODB_TOTAL_SEGMENTS = exports.SEMATTRS_AWS_DYNAMODB_SEGMENT = exports.SEMATTRS_AWS_DYNAMODB_SCAN_FORWARD = exports.SEMATTRS_AWS_DYNAMODB_TABLE_COUNT = exports.SEMATTRS_AWS_DYNAMODB_EXCLUSIVE_START_TABLE = exports.SEMATTRS_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = exports.SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = exports.SEMATTRS_AWS_DYNAMODB_SELECT = exports.SEMATTRS_AWS_DYNAMODB_INDEX_NAME = exports.SEMATTRS_AWS_DYNAMODB_ATTRIBUTES_TO_GET = exports.SEMATTRS_AWS_DYNAMODB_LIMIT = exports.SEMATTRS_AWS_DYNAMODB_PROJECTION = exports.SEMATTRS_AWS_DYNAMODB_CONSISTENT_READ = exports.SEMATTRS_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = exports.SEMATTRS_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = exports.SEMATTRS_AWS_DYNAMODB_ITEM_COLLECTION_METRICS = exports.SEMATTRS_AWS_DYNAMODB_CONSUMED_CAPACITY = exports.SEMATTRS_AWS_DYNAMODB_TABLE_NAMES = exports.SEMATTRS_HTTP_CLIENT_IP = exports.SEMATTRS_HTTP_ROUTE = exports.SEMATTRS_HTTP_SERVER_NAME = exports.SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = exports.SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH = exports.SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = exports.SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH = exports.SEMATTRS_HTTP_USER_AGENT = exports.SEMATTRS_HTTP_FLAVOR = exports.SEMATTRS_HTTP_STATUS_CODE = exports.SEMATTRS_HTTP_SCHEME = exports.SEMATTRS_HTTP_HOST = exports.SEMATTRS_HTTP_TARGET = exports.SEMATTRS_HTTP_URL = exports.SEMATTRS_HTTP_METHOD = exports.SEMATTRS_CODE_LINENO = exports.SEMATTRS_CODE_FILEPATH = exports.SEMATTRS_CODE_NAMESPACE = exports.SEMATTRS_CODE_FUNCTION = exports.SEMATTRS_THREAD_NAME = exports.SEMATTRS_THREAD_ID = exports.SEMATTRS_ENDUSER_SCOPE = exports.SEMATTRS_ENDUSER_ROLE = exports.SEMATTRS_ENDUSER_ID = exports.SEMATTRS_PEER_SERVICE = void 0;
    exports.DBSYSTEMVALUES_FILEMAKER = exports.DBSYSTEMVALUES_DERBY = exports.DBSYSTEMVALUES_FIREBIRD = exports.DBSYSTEMVALUES_ADABAS = exports.DBSYSTEMVALUES_CACHE = exports.DBSYSTEMVALUES_EDB = exports.DBSYSTEMVALUES_FIRSTSQL = exports.DBSYSTEMVALUES_INGRES = exports.DBSYSTEMVALUES_HANADB = exports.DBSYSTEMVALUES_MAXDB = exports.DBSYSTEMVALUES_PROGRESS = exports.DBSYSTEMVALUES_HSQLDB = exports.DBSYSTEMVALUES_CLOUDSCAPE = exports.DBSYSTEMVALUES_HIVE = exports.DBSYSTEMVALUES_REDSHIFT = exports.DBSYSTEMVALUES_POSTGRESQL = exports.DBSYSTEMVALUES_DB2 = exports.DBSYSTEMVALUES_ORACLE = exports.DBSYSTEMVALUES_MYSQL = exports.DBSYSTEMVALUES_MSSQL = exports.DBSYSTEMVALUES_OTHER_SQL = exports.SemanticAttributes = exports.SEMATTRS_MESSAGE_UNCOMPRESSED_SIZE = exports.SEMATTRS_MESSAGE_COMPRESSED_SIZE = exports.SEMATTRS_MESSAGE_ID = exports.SEMATTRS_MESSAGE_TYPE = exports.SEMATTRS_RPC_JSONRPC_ERROR_MESSAGE = exports.SEMATTRS_RPC_JSONRPC_ERROR_CODE = exports.SEMATTRS_RPC_JSONRPC_REQUEST_ID = exports.SEMATTRS_RPC_JSONRPC_VERSION = exports.SEMATTRS_RPC_GRPC_STATUS_CODE = exports.SEMATTRS_RPC_METHOD = exports.SEMATTRS_RPC_SERVICE = exports.SEMATTRS_RPC_SYSTEM = exports.SEMATTRS_MESSAGING_KAFKA_TOMBSTONE = exports.SEMATTRS_MESSAGING_KAFKA_PARTITION = exports.SEMATTRS_MESSAGING_KAFKA_CLIENT_ID = exports.SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP = exports.SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY = exports.SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY = exports.SEMATTRS_MESSAGING_CONSUMER_ID = exports.SEMATTRS_MESSAGING_OPERATION = exports.SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = exports.SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = exports.SEMATTRS_MESSAGING_CONVERSATION_ID = exports.SEMATTRS_MESSAGING_MESSAGE_ID = exports.SEMATTRS_MESSAGING_URL = exports.SEMATTRS_MESSAGING_PROTOCOL_VERSION = exports.SEMATTRS_MESSAGING_PROTOCOL = exports.SEMATTRS_MESSAGING_TEMP_DESTINATION = void 0;
    exports.FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD = exports.FaasDocumentOperationValues = exports.FAASDOCUMENTOPERATIONVALUES_DELETE = exports.FAASDOCUMENTOPERATIONVALUES_EDIT = exports.FAASDOCUMENTOPERATIONVALUES_INSERT = exports.FaasTriggerValues = exports.FAASTRIGGERVALUES_OTHER = exports.FAASTRIGGERVALUES_TIMER = exports.FAASTRIGGERVALUES_PUBSUB = exports.FAASTRIGGERVALUES_HTTP = exports.FAASTRIGGERVALUES_DATASOURCE = exports.DbCassandraConsistencyLevelValues = exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL = exports.DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL = exports.DBCASSANDRACONSISTENCYLEVELVALUES_ANY = exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE = exports.DBCASSANDRACONSISTENCYLEVELVALUES_THREE = exports.DBCASSANDRACONSISTENCYLEVELVALUES_TWO = exports.DBCASSANDRACONSISTENCYLEVELVALUES_ONE = exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM = exports.DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM = exports.DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM = exports.DBCASSANDRACONSISTENCYLEVELVALUES_ALL = exports.DbSystemValues = exports.DBSYSTEMVALUES_COCKROACHDB = exports.DBSYSTEMVALUES_MEMCACHED = exports.DBSYSTEMVALUES_ELASTICSEARCH = exports.DBSYSTEMVALUES_GEODE = exports.DBSYSTEMVALUES_NEO4J = exports.DBSYSTEMVALUES_DYNAMODB = exports.DBSYSTEMVALUES_COSMOSDB = exports.DBSYSTEMVALUES_COUCHDB = exports.DBSYSTEMVALUES_COUCHBASE = exports.DBSYSTEMVALUES_REDIS = exports.DBSYSTEMVALUES_MONGODB = exports.DBSYSTEMVALUES_HBASE = exports.DBSYSTEMVALUES_CASSANDRA = exports.DBSYSTEMVALUES_COLDFUSION = exports.DBSYSTEMVALUES_H2 = exports.DBSYSTEMVALUES_VERTICA = exports.DBSYSTEMVALUES_TERADATA = exports.DBSYSTEMVALUES_SYBASE = exports.DBSYSTEMVALUES_SQLITE = exports.DBSYSTEMVALUES_POINTBASE = exports.DBSYSTEMVALUES_PERVASIVE = exports.DBSYSTEMVALUES_NETEZZA = exports.DBSYSTEMVALUES_MARIADB = exports.DBSYSTEMVALUES_INTERBASE = exports.DBSYSTEMVALUES_INSTANTDB = exports.DBSYSTEMVALUES_INFORMIX = void 0;
    exports.MESSAGINGOPERATIONVALUES_RECEIVE = exports.MessagingDestinationKindValues = exports.MESSAGINGDESTINATIONKINDVALUES_TOPIC = exports.MESSAGINGDESTINATIONKINDVALUES_QUEUE = exports.HttpFlavorValues = exports.HTTPFLAVORVALUES_QUIC = exports.HTTPFLAVORVALUES_SPDY = exports.HTTPFLAVORVALUES_HTTP_2_0 = exports.HTTPFLAVORVALUES_HTTP_1_1 = exports.HTTPFLAVORVALUES_HTTP_1_0 = exports.NetHostConnectionSubtypeValues = exports.NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_NR = exports.NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN = exports.NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_GSM = exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP = exports.NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD = exports.NETHOSTCONNECTIONSUBTYPEVALUES_LTE = exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B = exports.NETHOSTCONNECTIONSUBTYPEVALUES_IDEN = exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSPA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT = exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A = exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0 = exports.NETHOSTCONNECTIONSUBTYPEVALUES_CDMA = exports.NETHOSTCONNECTIONSUBTYPEVALUES_UMTS = exports.NETHOSTCONNECTIONSUBTYPEVALUES_EDGE = exports.NETHOSTCONNECTIONSUBTYPEVALUES_GPRS = exports.NetHostConnectionTypeValues = exports.NETHOSTCONNECTIONTYPEVALUES_UNKNOWN = exports.NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE = exports.NETHOSTCONNECTIONTYPEVALUES_CELL = exports.NETHOSTCONNECTIONTYPEVALUES_WIRED = exports.NETHOSTCONNECTIONTYPEVALUES_WIFI = exports.NetTransportValues = exports.NETTRANSPORTVALUES_OTHER = exports.NETTRANSPORTVALUES_INPROC = exports.NETTRANSPORTVALUES_PIPE = exports.NETTRANSPORTVALUES_UNIX = exports.NETTRANSPORTVALUES_IP = exports.NETTRANSPORTVALUES_IP_UDP = exports.NETTRANSPORTVALUES_IP_TCP = exports.FaasInvokedProviderValues = exports.FAASINVOKEDPROVIDERVALUES_GCP = exports.FAASINVOKEDPROVIDERVALUES_AZURE = exports.FAASINVOKEDPROVIDERVALUES_AWS = void 0;
    exports.MessageTypeValues = exports.MESSAGETYPEVALUES_RECEIVED = exports.MESSAGETYPEVALUES_SENT = exports.RpcGrpcStatusCodeValues = exports.RPCGRPCSTATUSCODEVALUES_UNAUTHENTICATED = exports.RPCGRPCSTATUSCODEVALUES_DATA_LOSS = exports.RPCGRPCSTATUSCODEVALUES_UNAVAILABLE = exports.RPCGRPCSTATUSCODEVALUES_INTERNAL = exports.RPCGRPCSTATUSCODEVALUES_UNIMPLEMENTED = exports.RPCGRPCSTATUSCODEVALUES_OUT_OF_RANGE = exports.RPCGRPCSTATUSCODEVALUES_ABORTED = exports.RPCGRPCSTATUSCODEVALUES_FAILED_PRECONDITION = exports.RPCGRPCSTATUSCODEVALUES_RESOURCE_EXHAUSTED = exports.RPCGRPCSTATUSCODEVALUES_PERMISSION_DENIED = exports.RPCGRPCSTATUSCODEVALUES_ALREADY_EXISTS = exports.RPCGRPCSTATUSCODEVALUES_NOT_FOUND = exports.RPCGRPCSTATUSCODEVALUES_DEADLINE_EXCEEDED = exports.RPCGRPCSTATUSCODEVALUES_INVALID_ARGUMENT = exports.RPCGRPCSTATUSCODEVALUES_UNKNOWN = exports.RPCGRPCSTATUSCODEVALUES_CANCELLED = exports.RPCGRPCSTATUSCODEVALUES_OK = exports.MessagingOperationValues = exports.MESSAGINGOPERATIONVALUES_PROCESS = void 0;
    var utils_1 = require_utils4();
    var TMP_AWS_LAMBDA_INVOKED_ARN = "aws.lambda.invoked_arn";
    var TMP_DB_SYSTEM = "db.system";
    var TMP_DB_CONNECTION_STRING = "db.connection_string";
    var TMP_DB_USER = "db.user";
    var TMP_DB_JDBC_DRIVER_CLASSNAME = "db.jdbc.driver_classname";
    var TMP_DB_NAME = "db.name";
    var TMP_DB_STATEMENT = "db.statement";
    var TMP_DB_OPERATION = "db.operation";
    var TMP_DB_MSSQL_INSTANCE_NAME = "db.mssql.instance_name";
    var TMP_DB_CASSANDRA_KEYSPACE = "db.cassandra.keyspace";
    var TMP_DB_CASSANDRA_PAGE_SIZE = "db.cassandra.page_size";
    var TMP_DB_CASSANDRA_CONSISTENCY_LEVEL = "db.cassandra.consistency_level";
    var TMP_DB_CASSANDRA_TABLE = "db.cassandra.table";
    var TMP_DB_CASSANDRA_IDEMPOTENCE = "db.cassandra.idempotence";
    var TMP_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = "db.cassandra.speculative_execution_count";
    var TMP_DB_CASSANDRA_COORDINATOR_ID = "db.cassandra.coordinator.id";
    var TMP_DB_CASSANDRA_COORDINATOR_DC = "db.cassandra.coordinator.dc";
    var TMP_DB_HBASE_NAMESPACE = "db.hbase.namespace";
    var TMP_DB_REDIS_DATABASE_INDEX = "db.redis.database_index";
    var TMP_DB_MONGODB_COLLECTION = "db.mongodb.collection";
    var TMP_DB_SQL_TABLE = "db.sql.table";
    var TMP_EXCEPTION_TYPE = "exception.type";
    var TMP_EXCEPTION_MESSAGE = "exception.message";
    var TMP_EXCEPTION_STACKTRACE = "exception.stacktrace";
    var TMP_EXCEPTION_ESCAPED = "exception.escaped";
    var TMP_FAAS_TRIGGER = "faas.trigger";
    var TMP_FAAS_EXECUTION = "faas.execution";
    var TMP_FAAS_DOCUMENT_COLLECTION = "faas.document.collection";
    var TMP_FAAS_DOCUMENT_OPERATION = "faas.document.operation";
    var TMP_FAAS_DOCUMENT_TIME = "faas.document.time";
    var TMP_FAAS_DOCUMENT_NAME = "faas.document.name";
    var TMP_FAAS_TIME = "faas.time";
    var TMP_FAAS_CRON = "faas.cron";
    var TMP_FAAS_COLDSTART = "faas.coldstart";
    var TMP_FAAS_INVOKED_NAME = "faas.invoked_name";
    var TMP_FAAS_INVOKED_PROVIDER = "faas.invoked_provider";
    var TMP_FAAS_INVOKED_REGION = "faas.invoked_region";
    var TMP_NET_TRANSPORT = "net.transport";
    var TMP_NET_PEER_IP = "net.peer.ip";
    var TMP_NET_PEER_PORT = "net.peer.port";
    var TMP_NET_PEER_NAME = "net.peer.name";
    var TMP_NET_HOST_IP = "net.host.ip";
    var TMP_NET_HOST_PORT = "net.host.port";
    var TMP_NET_HOST_NAME = "net.host.name";
    var TMP_NET_HOST_CONNECTION_TYPE = "net.host.connection.type";
    var TMP_NET_HOST_CONNECTION_SUBTYPE = "net.host.connection.subtype";
    var TMP_NET_HOST_CARRIER_NAME = "net.host.carrier.name";
    var TMP_NET_HOST_CARRIER_MCC = "net.host.carrier.mcc";
    var TMP_NET_HOST_CARRIER_MNC = "net.host.carrier.mnc";
    var TMP_NET_HOST_CARRIER_ICC = "net.host.carrier.icc";
    var TMP_PEER_SERVICE = "peer.service";
    var TMP_ENDUSER_ID = "enduser.id";
    var TMP_ENDUSER_ROLE = "enduser.role";
    var TMP_ENDUSER_SCOPE = "enduser.scope";
    var TMP_THREAD_ID = "thread.id";
    var TMP_THREAD_NAME = "thread.name";
    var TMP_CODE_FUNCTION = "code.function";
    var TMP_CODE_NAMESPACE = "code.namespace";
    var TMP_CODE_FILEPATH = "code.filepath";
    var TMP_CODE_LINENO = "code.lineno";
    var TMP_HTTP_METHOD = "http.method";
    var TMP_HTTP_URL = "http.url";
    var TMP_HTTP_TARGET = "http.target";
    var TMP_HTTP_HOST = "http.host";
    var TMP_HTTP_SCHEME = "http.scheme";
    var TMP_HTTP_STATUS_CODE = "http.status_code";
    var TMP_HTTP_FLAVOR = "http.flavor";
    var TMP_HTTP_USER_AGENT = "http.user_agent";
    var TMP_HTTP_REQUEST_CONTENT_LENGTH = "http.request_content_length";
    var TMP_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = "http.request_content_length_uncompressed";
    var TMP_HTTP_RESPONSE_CONTENT_LENGTH = "http.response_content_length";
    var TMP_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = "http.response_content_length_uncompressed";
    var TMP_HTTP_SERVER_NAME = "http.server_name";
    var TMP_HTTP_ROUTE = "http.route";
    var TMP_HTTP_CLIENT_IP = "http.client_ip";
    var TMP_AWS_DYNAMODB_TABLE_NAMES = "aws.dynamodb.table_names";
    var TMP_AWS_DYNAMODB_CONSUMED_CAPACITY = "aws.dynamodb.consumed_capacity";
    var TMP_AWS_DYNAMODB_ITEM_COLLECTION_METRICS = "aws.dynamodb.item_collection_metrics";
    var TMP_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = "aws.dynamodb.provisioned_read_capacity";
    var TMP_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = "aws.dynamodb.provisioned_write_capacity";
    var TMP_AWS_DYNAMODB_CONSISTENT_READ = "aws.dynamodb.consistent_read";
    var TMP_AWS_DYNAMODB_PROJECTION = "aws.dynamodb.projection";
    var TMP_AWS_DYNAMODB_LIMIT = "aws.dynamodb.limit";
    var TMP_AWS_DYNAMODB_ATTRIBUTES_TO_GET = "aws.dynamodb.attributes_to_get";
    var TMP_AWS_DYNAMODB_INDEX_NAME = "aws.dynamodb.index_name";
    var TMP_AWS_DYNAMODB_SELECT = "aws.dynamodb.select";
    var TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = "aws.dynamodb.global_secondary_indexes";
    var TMP_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = "aws.dynamodb.local_secondary_indexes";
    var TMP_AWS_DYNAMODB_EXCLUSIVE_START_TABLE = "aws.dynamodb.exclusive_start_table";
    var TMP_AWS_DYNAMODB_TABLE_COUNT = "aws.dynamodb.table_count";
    var TMP_AWS_DYNAMODB_SCAN_FORWARD = "aws.dynamodb.scan_forward";
    var TMP_AWS_DYNAMODB_SEGMENT = "aws.dynamodb.segment";
    var TMP_AWS_DYNAMODB_TOTAL_SEGMENTS = "aws.dynamodb.total_segments";
    var TMP_AWS_DYNAMODB_COUNT = "aws.dynamodb.count";
    var TMP_AWS_DYNAMODB_SCANNED_COUNT = "aws.dynamodb.scanned_count";
    var TMP_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = "aws.dynamodb.attribute_definitions";
    var TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = "aws.dynamodb.global_secondary_index_updates";
    var TMP_MESSAGING_SYSTEM = "messaging.system";
    var TMP_MESSAGING_DESTINATION = "messaging.destination";
    var TMP_MESSAGING_DESTINATION_KIND = "messaging.destination_kind";
    var TMP_MESSAGING_TEMP_DESTINATION = "messaging.temp_destination";
    var TMP_MESSAGING_PROTOCOL = "messaging.protocol";
    var TMP_MESSAGING_PROTOCOL_VERSION = "messaging.protocol_version";
    var TMP_MESSAGING_URL = "messaging.url";
    var TMP_MESSAGING_MESSAGE_ID = "messaging.message_id";
    var TMP_MESSAGING_CONVERSATION_ID = "messaging.conversation_id";
    var TMP_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = "messaging.message_payload_size_bytes";
    var TMP_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = "messaging.message_payload_compressed_size_bytes";
    var TMP_MESSAGING_OPERATION = "messaging.operation";
    var TMP_MESSAGING_CONSUMER_ID = "messaging.consumer_id";
    var TMP_MESSAGING_RABBITMQ_ROUTING_KEY = "messaging.rabbitmq.routing_key";
    var TMP_MESSAGING_KAFKA_MESSAGE_KEY = "messaging.kafka.message_key";
    var TMP_MESSAGING_KAFKA_CONSUMER_GROUP = "messaging.kafka.consumer_group";
    var TMP_MESSAGING_KAFKA_CLIENT_ID = "messaging.kafka.client_id";
    var TMP_MESSAGING_KAFKA_PARTITION = "messaging.kafka.partition";
    var TMP_MESSAGING_KAFKA_TOMBSTONE = "messaging.kafka.tombstone";
    var TMP_RPC_SYSTEM = "rpc.system";
    var TMP_RPC_SERVICE = "rpc.service";
    var TMP_RPC_METHOD = "rpc.method";
    var TMP_RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code";
    var TMP_RPC_JSONRPC_VERSION = "rpc.jsonrpc.version";
    var TMP_RPC_JSONRPC_REQUEST_ID = "rpc.jsonrpc.request_id";
    var TMP_RPC_JSONRPC_ERROR_CODE = "rpc.jsonrpc.error_code";
    var TMP_RPC_JSONRPC_ERROR_MESSAGE = "rpc.jsonrpc.error_message";
    var TMP_MESSAGE_TYPE = "message.type";
    var TMP_MESSAGE_ID = "message.id";
    var TMP_MESSAGE_COMPRESSED_SIZE = "message.compressed_size";
    var TMP_MESSAGE_UNCOMPRESSED_SIZE = "message.uncompressed_size";
    exports.SEMATTRS_AWS_LAMBDA_INVOKED_ARN = TMP_AWS_LAMBDA_INVOKED_ARN;
    exports.SEMATTRS_DB_SYSTEM = TMP_DB_SYSTEM;
    exports.SEMATTRS_DB_CONNECTION_STRING = TMP_DB_CONNECTION_STRING;
    exports.SEMATTRS_DB_USER = TMP_DB_USER;
    exports.SEMATTRS_DB_JDBC_DRIVER_CLASSNAME = TMP_DB_JDBC_DRIVER_CLASSNAME;
    exports.SEMATTRS_DB_NAME = TMP_DB_NAME;
    exports.SEMATTRS_DB_STATEMENT = TMP_DB_STATEMENT;
    exports.SEMATTRS_DB_OPERATION = TMP_DB_OPERATION;
    exports.SEMATTRS_DB_MSSQL_INSTANCE_NAME = TMP_DB_MSSQL_INSTANCE_NAME;
    exports.SEMATTRS_DB_CASSANDRA_KEYSPACE = TMP_DB_CASSANDRA_KEYSPACE;
    exports.SEMATTRS_DB_CASSANDRA_PAGE_SIZE = TMP_DB_CASSANDRA_PAGE_SIZE;
    exports.SEMATTRS_DB_CASSANDRA_CONSISTENCY_LEVEL = TMP_DB_CASSANDRA_CONSISTENCY_LEVEL;
    exports.SEMATTRS_DB_CASSANDRA_TABLE = TMP_DB_CASSANDRA_TABLE;
    exports.SEMATTRS_DB_CASSANDRA_IDEMPOTENCE = TMP_DB_CASSANDRA_IDEMPOTENCE;
    exports.SEMATTRS_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = TMP_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT;
    exports.SEMATTRS_DB_CASSANDRA_COORDINATOR_ID = TMP_DB_CASSANDRA_COORDINATOR_ID;
    exports.SEMATTRS_DB_CASSANDRA_COORDINATOR_DC = TMP_DB_CASSANDRA_COORDINATOR_DC;
    exports.SEMATTRS_DB_HBASE_NAMESPACE = TMP_DB_HBASE_NAMESPACE;
    exports.SEMATTRS_DB_REDIS_DATABASE_INDEX = TMP_DB_REDIS_DATABASE_INDEX;
    exports.SEMATTRS_DB_MONGODB_COLLECTION = TMP_DB_MONGODB_COLLECTION;
    exports.SEMATTRS_DB_SQL_TABLE = TMP_DB_SQL_TABLE;
    exports.SEMATTRS_EXCEPTION_TYPE = TMP_EXCEPTION_TYPE;
    exports.SEMATTRS_EXCEPTION_MESSAGE = TMP_EXCEPTION_MESSAGE;
    exports.SEMATTRS_EXCEPTION_STACKTRACE = TMP_EXCEPTION_STACKTRACE;
    exports.SEMATTRS_EXCEPTION_ESCAPED = TMP_EXCEPTION_ESCAPED;
    exports.SEMATTRS_FAAS_TRIGGER = TMP_FAAS_TRIGGER;
    exports.SEMATTRS_FAAS_EXECUTION = TMP_FAAS_EXECUTION;
    exports.SEMATTRS_FAAS_DOCUMENT_COLLECTION = TMP_FAAS_DOCUMENT_COLLECTION;
    exports.SEMATTRS_FAAS_DOCUMENT_OPERATION = TMP_FAAS_DOCUMENT_OPERATION;
    exports.SEMATTRS_FAAS_DOCUMENT_TIME = TMP_FAAS_DOCUMENT_TIME;
    exports.SEMATTRS_FAAS_DOCUMENT_NAME = TMP_FAAS_DOCUMENT_NAME;
    exports.SEMATTRS_FAAS_TIME = TMP_FAAS_TIME;
    exports.SEMATTRS_FAAS_CRON = TMP_FAAS_CRON;
    exports.SEMATTRS_FAAS_COLDSTART = TMP_FAAS_COLDSTART;
    exports.SEMATTRS_FAAS_INVOKED_NAME = TMP_FAAS_INVOKED_NAME;
    exports.SEMATTRS_FAAS_INVOKED_PROVIDER = TMP_FAAS_INVOKED_PROVIDER;
    exports.SEMATTRS_FAAS_INVOKED_REGION = TMP_FAAS_INVOKED_REGION;
    exports.SEMATTRS_NET_TRANSPORT = TMP_NET_TRANSPORT;
    exports.SEMATTRS_NET_PEER_IP = TMP_NET_PEER_IP;
    exports.SEMATTRS_NET_PEER_PORT = TMP_NET_PEER_PORT;
    exports.SEMATTRS_NET_PEER_NAME = TMP_NET_PEER_NAME;
    exports.SEMATTRS_NET_HOST_IP = TMP_NET_HOST_IP;
    exports.SEMATTRS_NET_HOST_PORT = TMP_NET_HOST_PORT;
    exports.SEMATTRS_NET_HOST_NAME = TMP_NET_HOST_NAME;
    exports.SEMATTRS_NET_HOST_CONNECTION_TYPE = TMP_NET_HOST_CONNECTION_TYPE;
    exports.SEMATTRS_NET_HOST_CONNECTION_SUBTYPE = TMP_NET_HOST_CONNECTION_SUBTYPE;
    exports.SEMATTRS_NET_HOST_CARRIER_NAME = TMP_NET_HOST_CARRIER_NAME;
    exports.SEMATTRS_NET_HOST_CARRIER_MCC = TMP_NET_HOST_CARRIER_MCC;
    exports.SEMATTRS_NET_HOST_CARRIER_MNC = TMP_NET_HOST_CARRIER_MNC;
    exports.SEMATTRS_NET_HOST_CARRIER_ICC = TMP_NET_HOST_CARRIER_ICC;
    exports.SEMATTRS_PEER_SERVICE = TMP_PEER_SERVICE;
    exports.SEMATTRS_ENDUSER_ID = TMP_ENDUSER_ID;
    exports.SEMATTRS_ENDUSER_ROLE = TMP_ENDUSER_ROLE;
    exports.SEMATTRS_ENDUSER_SCOPE = TMP_ENDUSER_SCOPE;
    exports.SEMATTRS_THREAD_ID = TMP_THREAD_ID;
    exports.SEMATTRS_THREAD_NAME = TMP_THREAD_NAME;
    exports.SEMATTRS_CODE_FUNCTION = TMP_CODE_FUNCTION;
    exports.SEMATTRS_CODE_NAMESPACE = TMP_CODE_NAMESPACE;
    exports.SEMATTRS_CODE_FILEPATH = TMP_CODE_FILEPATH;
    exports.SEMATTRS_CODE_LINENO = TMP_CODE_LINENO;
    exports.SEMATTRS_HTTP_METHOD = TMP_HTTP_METHOD;
    exports.SEMATTRS_HTTP_URL = TMP_HTTP_URL;
    exports.SEMATTRS_HTTP_TARGET = TMP_HTTP_TARGET;
    exports.SEMATTRS_HTTP_HOST = TMP_HTTP_HOST;
    exports.SEMATTRS_HTTP_SCHEME = TMP_HTTP_SCHEME;
    exports.SEMATTRS_HTTP_STATUS_CODE = TMP_HTTP_STATUS_CODE;
    exports.SEMATTRS_HTTP_FLAVOR = TMP_HTTP_FLAVOR;
    exports.SEMATTRS_HTTP_USER_AGENT = TMP_HTTP_USER_AGENT;
    exports.SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH = TMP_HTTP_REQUEST_CONTENT_LENGTH;
    exports.SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = TMP_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED;
    exports.SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH = TMP_HTTP_RESPONSE_CONTENT_LENGTH;
    exports.SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = TMP_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED;
    exports.SEMATTRS_HTTP_SERVER_NAME = TMP_HTTP_SERVER_NAME;
    exports.SEMATTRS_HTTP_ROUTE = TMP_HTTP_ROUTE;
    exports.SEMATTRS_HTTP_CLIENT_IP = TMP_HTTP_CLIENT_IP;
    exports.SEMATTRS_AWS_DYNAMODB_TABLE_NAMES = TMP_AWS_DYNAMODB_TABLE_NAMES;
    exports.SEMATTRS_AWS_DYNAMODB_CONSUMED_CAPACITY = TMP_AWS_DYNAMODB_CONSUMED_CAPACITY;
    exports.SEMATTRS_AWS_DYNAMODB_ITEM_COLLECTION_METRICS = TMP_AWS_DYNAMODB_ITEM_COLLECTION_METRICS;
    exports.SEMATTRS_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = TMP_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY;
    exports.SEMATTRS_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = TMP_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY;
    exports.SEMATTRS_AWS_DYNAMODB_CONSISTENT_READ = TMP_AWS_DYNAMODB_CONSISTENT_READ;
    exports.SEMATTRS_AWS_DYNAMODB_PROJECTION = TMP_AWS_DYNAMODB_PROJECTION;
    exports.SEMATTRS_AWS_DYNAMODB_LIMIT = TMP_AWS_DYNAMODB_LIMIT;
    exports.SEMATTRS_AWS_DYNAMODB_ATTRIBUTES_TO_GET = TMP_AWS_DYNAMODB_ATTRIBUTES_TO_GET;
    exports.SEMATTRS_AWS_DYNAMODB_INDEX_NAME = TMP_AWS_DYNAMODB_INDEX_NAME;
    exports.SEMATTRS_AWS_DYNAMODB_SELECT = TMP_AWS_DYNAMODB_SELECT;
    exports.SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES;
    exports.SEMATTRS_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = TMP_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES;
    exports.SEMATTRS_AWS_DYNAMODB_EXCLUSIVE_START_TABLE = TMP_AWS_DYNAMODB_EXCLUSIVE_START_TABLE;
    exports.SEMATTRS_AWS_DYNAMODB_TABLE_COUNT = TMP_AWS_DYNAMODB_TABLE_COUNT;
    exports.SEMATTRS_AWS_DYNAMODB_SCAN_FORWARD = TMP_AWS_DYNAMODB_SCAN_FORWARD;
    exports.SEMATTRS_AWS_DYNAMODB_SEGMENT = TMP_AWS_DYNAMODB_SEGMENT;
    exports.SEMATTRS_AWS_DYNAMODB_TOTAL_SEGMENTS = TMP_AWS_DYNAMODB_TOTAL_SEGMENTS;
    exports.SEMATTRS_AWS_DYNAMODB_COUNT = TMP_AWS_DYNAMODB_COUNT;
    exports.SEMATTRS_AWS_DYNAMODB_SCANNED_COUNT = TMP_AWS_DYNAMODB_SCANNED_COUNT;
    exports.SEMATTRS_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = TMP_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS;
    exports.SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES;
    exports.SEMATTRS_MESSAGING_SYSTEM = TMP_MESSAGING_SYSTEM;
    exports.SEMATTRS_MESSAGING_DESTINATION = TMP_MESSAGING_DESTINATION;
    exports.SEMATTRS_MESSAGING_DESTINATION_KIND = TMP_MESSAGING_DESTINATION_KIND;
    exports.SEMATTRS_MESSAGING_TEMP_DESTINATION = TMP_MESSAGING_TEMP_DESTINATION;
    exports.SEMATTRS_MESSAGING_PROTOCOL = TMP_MESSAGING_PROTOCOL;
    exports.SEMATTRS_MESSAGING_PROTOCOL_VERSION = TMP_MESSAGING_PROTOCOL_VERSION;
    exports.SEMATTRS_MESSAGING_URL = TMP_MESSAGING_URL;
    exports.SEMATTRS_MESSAGING_MESSAGE_ID = TMP_MESSAGING_MESSAGE_ID;
    exports.SEMATTRS_MESSAGING_CONVERSATION_ID = TMP_MESSAGING_CONVERSATION_ID;
    exports.SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = TMP_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES;
    exports.SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = TMP_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES;
    exports.SEMATTRS_MESSAGING_OPERATION = TMP_MESSAGING_OPERATION;
    exports.SEMATTRS_MESSAGING_CONSUMER_ID = TMP_MESSAGING_CONSUMER_ID;
    exports.SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY = TMP_MESSAGING_RABBITMQ_ROUTING_KEY;
    exports.SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY = TMP_MESSAGING_KAFKA_MESSAGE_KEY;
    exports.SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP = TMP_MESSAGING_KAFKA_CONSUMER_GROUP;
    exports.SEMATTRS_MESSAGING_KAFKA_CLIENT_ID = TMP_MESSAGING_KAFKA_CLIENT_ID;
    exports.SEMATTRS_MESSAGING_KAFKA_PARTITION = TMP_MESSAGING_KAFKA_PARTITION;
    exports.SEMATTRS_MESSAGING_KAFKA_TOMBSTONE = TMP_MESSAGING_KAFKA_TOMBSTONE;
    exports.SEMATTRS_RPC_SYSTEM = TMP_RPC_SYSTEM;
    exports.SEMATTRS_RPC_SERVICE = TMP_RPC_SERVICE;
    exports.SEMATTRS_RPC_METHOD = TMP_RPC_METHOD;
    exports.SEMATTRS_RPC_GRPC_STATUS_CODE = TMP_RPC_GRPC_STATUS_CODE;
    exports.SEMATTRS_RPC_JSONRPC_VERSION = TMP_RPC_JSONRPC_VERSION;
    exports.SEMATTRS_RPC_JSONRPC_REQUEST_ID = TMP_RPC_JSONRPC_REQUEST_ID;
    exports.SEMATTRS_RPC_JSONRPC_ERROR_CODE = TMP_RPC_JSONRPC_ERROR_CODE;
    exports.SEMATTRS_RPC_JSONRPC_ERROR_MESSAGE = TMP_RPC_JSONRPC_ERROR_MESSAGE;
    exports.SEMATTRS_MESSAGE_TYPE = TMP_MESSAGE_TYPE;
    exports.SEMATTRS_MESSAGE_ID = TMP_MESSAGE_ID;
    exports.SEMATTRS_MESSAGE_COMPRESSED_SIZE = TMP_MESSAGE_COMPRESSED_SIZE;
    exports.SEMATTRS_MESSAGE_UNCOMPRESSED_SIZE = TMP_MESSAGE_UNCOMPRESSED_SIZE;
    exports.SemanticAttributes = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_AWS_LAMBDA_INVOKED_ARN,
      TMP_DB_SYSTEM,
      TMP_DB_CONNECTION_STRING,
      TMP_DB_USER,
      TMP_DB_JDBC_DRIVER_CLASSNAME,
      TMP_DB_NAME,
      TMP_DB_STATEMENT,
      TMP_DB_OPERATION,
      TMP_DB_MSSQL_INSTANCE_NAME,
      TMP_DB_CASSANDRA_KEYSPACE,
      TMP_DB_CASSANDRA_PAGE_SIZE,
      TMP_DB_CASSANDRA_CONSISTENCY_LEVEL,
      TMP_DB_CASSANDRA_TABLE,
      TMP_DB_CASSANDRA_IDEMPOTENCE,
      TMP_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT,
      TMP_DB_CASSANDRA_COORDINATOR_ID,
      TMP_DB_CASSANDRA_COORDINATOR_DC,
      TMP_DB_HBASE_NAMESPACE,
      TMP_DB_REDIS_DATABASE_INDEX,
      TMP_DB_MONGODB_COLLECTION,
      TMP_DB_SQL_TABLE,
      TMP_EXCEPTION_TYPE,
      TMP_EXCEPTION_MESSAGE,
      TMP_EXCEPTION_STACKTRACE,
      TMP_EXCEPTION_ESCAPED,
      TMP_FAAS_TRIGGER,
      TMP_FAAS_EXECUTION,
      TMP_FAAS_DOCUMENT_COLLECTION,
      TMP_FAAS_DOCUMENT_OPERATION,
      TMP_FAAS_DOCUMENT_TIME,
      TMP_FAAS_DOCUMENT_NAME,
      TMP_FAAS_TIME,
      TMP_FAAS_CRON,
      TMP_FAAS_COLDSTART,
      TMP_FAAS_INVOKED_NAME,
      TMP_FAAS_INVOKED_PROVIDER,
      TMP_FAAS_INVOKED_REGION,
      TMP_NET_TRANSPORT,
      TMP_NET_PEER_IP,
      TMP_NET_PEER_PORT,
      TMP_NET_PEER_NAME,
      TMP_NET_HOST_IP,
      TMP_NET_HOST_PORT,
      TMP_NET_HOST_NAME,
      TMP_NET_HOST_CONNECTION_TYPE,
      TMP_NET_HOST_CONNECTION_SUBTYPE,
      TMP_NET_HOST_CARRIER_NAME,
      TMP_NET_HOST_CARRIER_MCC,
      TMP_NET_HOST_CARRIER_MNC,
      TMP_NET_HOST_CARRIER_ICC,
      TMP_PEER_SERVICE,
      TMP_ENDUSER_ID,
      TMP_ENDUSER_ROLE,
      TMP_ENDUSER_SCOPE,
      TMP_THREAD_ID,
      TMP_THREAD_NAME,
      TMP_CODE_FUNCTION,
      TMP_CODE_NAMESPACE,
      TMP_CODE_FILEPATH,
      TMP_CODE_LINENO,
      TMP_HTTP_METHOD,
      TMP_HTTP_URL,
      TMP_HTTP_TARGET,
      TMP_HTTP_HOST,
      TMP_HTTP_SCHEME,
      TMP_HTTP_STATUS_CODE,
      TMP_HTTP_FLAVOR,
      TMP_HTTP_USER_AGENT,
      TMP_HTTP_REQUEST_CONTENT_LENGTH,
      TMP_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED,
      TMP_HTTP_RESPONSE_CONTENT_LENGTH,
      TMP_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED,
      TMP_HTTP_SERVER_NAME,
      TMP_HTTP_ROUTE,
      TMP_HTTP_CLIENT_IP,
      TMP_AWS_DYNAMODB_TABLE_NAMES,
      TMP_AWS_DYNAMODB_CONSUMED_CAPACITY,
      TMP_AWS_DYNAMODB_ITEM_COLLECTION_METRICS,
      TMP_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY,
      TMP_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY,
      TMP_AWS_DYNAMODB_CONSISTENT_READ,
      TMP_AWS_DYNAMODB_PROJECTION,
      TMP_AWS_DYNAMODB_LIMIT,
      TMP_AWS_DYNAMODB_ATTRIBUTES_TO_GET,
      TMP_AWS_DYNAMODB_INDEX_NAME,
      TMP_AWS_DYNAMODB_SELECT,
      TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES,
      TMP_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES,
      TMP_AWS_DYNAMODB_EXCLUSIVE_START_TABLE,
      TMP_AWS_DYNAMODB_TABLE_COUNT,
      TMP_AWS_DYNAMODB_SCAN_FORWARD,
      TMP_AWS_DYNAMODB_SEGMENT,
      TMP_AWS_DYNAMODB_TOTAL_SEGMENTS,
      TMP_AWS_DYNAMODB_COUNT,
      TMP_AWS_DYNAMODB_SCANNED_COUNT,
      TMP_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS,
      TMP_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES,
      TMP_MESSAGING_SYSTEM,
      TMP_MESSAGING_DESTINATION,
      TMP_MESSAGING_DESTINATION_KIND,
      TMP_MESSAGING_TEMP_DESTINATION,
      TMP_MESSAGING_PROTOCOL,
      TMP_MESSAGING_PROTOCOL_VERSION,
      TMP_MESSAGING_URL,
      TMP_MESSAGING_MESSAGE_ID,
      TMP_MESSAGING_CONVERSATION_ID,
      TMP_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES,
      TMP_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES,
      TMP_MESSAGING_OPERATION,
      TMP_MESSAGING_CONSUMER_ID,
      TMP_MESSAGING_RABBITMQ_ROUTING_KEY,
      TMP_MESSAGING_KAFKA_MESSAGE_KEY,
      TMP_MESSAGING_KAFKA_CONSUMER_GROUP,
      TMP_MESSAGING_KAFKA_CLIENT_ID,
      TMP_MESSAGING_KAFKA_PARTITION,
      TMP_MESSAGING_KAFKA_TOMBSTONE,
      TMP_RPC_SYSTEM,
      TMP_RPC_SERVICE,
      TMP_RPC_METHOD,
      TMP_RPC_GRPC_STATUS_CODE,
      TMP_RPC_JSONRPC_VERSION,
      TMP_RPC_JSONRPC_REQUEST_ID,
      TMP_RPC_JSONRPC_ERROR_CODE,
      TMP_RPC_JSONRPC_ERROR_MESSAGE,
      TMP_MESSAGE_TYPE,
      TMP_MESSAGE_ID,
      TMP_MESSAGE_COMPRESSED_SIZE,
      TMP_MESSAGE_UNCOMPRESSED_SIZE
    ]);
    var TMP_DBSYSTEMVALUES_OTHER_SQL = "other_sql";
    var TMP_DBSYSTEMVALUES_MSSQL = "mssql";
    var TMP_DBSYSTEMVALUES_MYSQL = "mysql";
    var TMP_DBSYSTEMVALUES_ORACLE = "oracle";
    var TMP_DBSYSTEMVALUES_DB2 = "db2";
    var TMP_DBSYSTEMVALUES_POSTGRESQL = "postgresql";
    var TMP_DBSYSTEMVALUES_REDSHIFT = "redshift";
    var TMP_DBSYSTEMVALUES_HIVE = "hive";
    var TMP_DBSYSTEMVALUES_CLOUDSCAPE = "cloudscape";
    var TMP_DBSYSTEMVALUES_HSQLDB = "hsqldb";
    var TMP_DBSYSTEMVALUES_PROGRESS = "progress";
    var TMP_DBSYSTEMVALUES_MAXDB = "maxdb";
    var TMP_DBSYSTEMVALUES_HANADB = "hanadb";
    var TMP_DBSYSTEMVALUES_INGRES = "ingres";
    var TMP_DBSYSTEMVALUES_FIRSTSQL = "firstsql";
    var TMP_DBSYSTEMVALUES_EDB = "edb";
    var TMP_DBSYSTEMVALUES_CACHE = "cache";
    var TMP_DBSYSTEMVALUES_ADABAS = "adabas";
    var TMP_DBSYSTEMVALUES_FIREBIRD = "firebird";
    var TMP_DBSYSTEMVALUES_DERBY = "derby";
    var TMP_DBSYSTEMVALUES_FILEMAKER = "filemaker";
    var TMP_DBSYSTEMVALUES_INFORMIX = "informix";
    var TMP_DBSYSTEMVALUES_INSTANTDB = "instantdb";
    var TMP_DBSYSTEMVALUES_INTERBASE = "interbase";
    var TMP_DBSYSTEMVALUES_MARIADB = "mariadb";
    var TMP_DBSYSTEMVALUES_NETEZZA = "netezza";
    var TMP_DBSYSTEMVALUES_PERVASIVE = "pervasive";
    var TMP_DBSYSTEMVALUES_POINTBASE = "pointbase";
    var TMP_DBSYSTEMVALUES_SQLITE = "sqlite";
    var TMP_DBSYSTEMVALUES_SYBASE = "sybase";
    var TMP_DBSYSTEMVALUES_TERADATA = "teradata";
    var TMP_DBSYSTEMVALUES_VERTICA = "vertica";
    var TMP_DBSYSTEMVALUES_H2 = "h2";
    var TMP_DBSYSTEMVALUES_COLDFUSION = "coldfusion";
    var TMP_DBSYSTEMVALUES_CASSANDRA = "cassandra";
    var TMP_DBSYSTEMVALUES_HBASE = "hbase";
    var TMP_DBSYSTEMVALUES_MONGODB = "mongodb";
    var TMP_DBSYSTEMVALUES_REDIS = "redis";
    var TMP_DBSYSTEMVALUES_COUCHBASE = "couchbase";
    var TMP_DBSYSTEMVALUES_COUCHDB = "couchdb";
    var TMP_DBSYSTEMVALUES_COSMOSDB = "cosmosdb";
    var TMP_DBSYSTEMVALUES_DYNAMODB = "dynamodb";
    var TMP_DBSYSTEMVALUES_NEO4J = "neo4j";
    var TMP_DBSYSTEMVALUES_GEODE = "geode";
    var TMP_DBSYSTEMVALUES_ELASTICSEARCH = "elasticsearch";
    var TMP_DBSYSTEMVALUES_MEMCACHED = "memcached";
    var TMP_DBSYSTEMVALUES_COCKROACHDB = "cockroachdb";
    exports.DBSYSTEMVALUES_OTHER_SQL = TMP_DBSYSTEMVALUES_OTHER_SQL;
    exports.DBSYSTEMVALUES_MSSQL = TMP_DBSYSTEMVALUES_MSSQL;
    exports.DBSYSTEMVALUES_MYSQL = TMP_DBSYSTEMVALUES_MYSQL;
    exports.DBSYSTEMVALUES_ORACLE = TMP_DBSYSTEMVALUES_ORACLE;
    exports.DBSYSTEMVALUES_DB2 = TMP_DBSYSTEMVALUES_DB2;
    exports.DBSYSTEMVALUES_POSTGRESQL = TMP_DBSYSTEMVALUES_POSTGRESQL;
    exports.DBSYSTEMVALUES_REDSHIFT = TMP_DBSYSTEMVALUES_REDSHIFT;
    exports.DBSYSTEMVALUES_HIVE = TMP_DBSYSTEMVALUES_HIVE;
    exports.DBSYSTEMVALUES_CLOUDSCAPE = TMP_DBSYSTEMVALUES_CLOUDSCAPE;
    exports.DBSYSTEMVALUES_HSQLDB = TMP_DBSYSTEMVALUES_HSQLDB;
    exports.DBSYSTEMVALUES_PROGRESS = TMP_DBSYSTEMVALUES_PROGRESS;
    exports.DBSYSTEMVALUES_MAXDB = TMP_DBSYSTEMVALUES_MAXDB;
    exports.DBSYSTEMVALUES_HANADB = TMP_DBSYSTEMVALUES_HANADB;
    exports.DBSYSTEMVALUES_INGRES = TMP_DBSYSTEMVALUES_INGRES;
    exports.DBSYSTEMVALUES_FIRSTSQL = TMP_DBSYSTEMVALUES_FIRSTSQL;
    exports.DBSYSTEMVALUES_EDB = TMP_DBSYSTEMVALUES_EDB;
    exports.DBSYSTEMVALUES_CACHE = TMP_DBSYSTEMVALUES_CACHE;
    exports.DBSYSTEMVALUES_ADABAS = TMP_DBSYSTEMVALUES_ADABAS;
    exports.DBSYSTEMVALUES_FIREBIRD = TMP_DBSYSTEMVALUES_FIREBIRD;
    exports.DBSYSTEMVALUES_DERBY = TMP_DBSYSTEMVALUES_DERBY;
    exports.DBSYSTEMVALUES_FILEMAKER = TMP_DBSYSTEMVALUES_FILEMAKER;
    exports.DBSYSTEMVALUES_INFORMIX = TMP_DBSYSTEMVALUES_INFORMIX;
    exports.DBSYSTEMVALUES_INSTANTDB = TMP_DBSYSTEMVALUES_INSTANTDB;
    exports.DBSYSTEMVALUES_INTERBASE = TMP_DBSYSTEMVALUES_INTERBASE;
    exports.DBSYSTEMVALUES_MARIADB = TMP_DBSYSTEMVALUES_MARIADB;
    exports.DBSYSTEMVALUES_NETEZZA = TMP_DBSYSTEMVALUES_NETEZZA;
    exports.DBSYSTEMVALUES_PERVASIVE = TMP_DBSYSTEMVALUES_PERVASIVE;
    exports.DBSYSTEMVALUES_POINTBASE = TMP_DBSYSTEMVALUES_POINTBASE;
    exports.DBSYSTEMVALUES_SQLITE = TMP_DBSYSTEMVALUES_SQLITE;
    exports.DBSYSTEMVALUES_SYBASE = TMP_DBSYSTEMVALUES_SYBASE;
    exports.DBSYSTEMVALUES_TERADATA = TMP_DBSYSTEMVALUES_TERADATA;
    exports.DBSYSTEMVALUES_VERTICA = TMP_DBSYSTEMVALUES_VERTICA;
    exports.DBSYSTEMVALUES_H2 = TMP_DBSYSTEMVALUES_H2;
    exports.DBSYSTEMVALUES_COLDFUSION = TMP_DBSYSTEMVALUES_COLDFUSION;
    exports.DBSYSTEMVALUES_CASSANDRA = TMP_DBSYSTEMVALUES_CASSANDRA;
    exports.DBSYSTEMVALUES_HBASE = TMP_DBSYSTEMVALUES_HBASE;
    exports.DBSYSTEMVALUES_MONGODB = TMP_DBSYSTEMVALUES_MONGODB;
    exports.DBSYSTEMVALUES_REDIS = TMP_DBSYSTEMVALUES_REDIS;
    exports.DBSYSTEMVALUES_COUCHBASE = TMP_DBSYSTEMVALUES_COUCHBASE;
    exports.DBSYSTEMVALUES_COUCHDB = TMP_DBSYSTEMVALUES_COUCHDB;
    exports.DBSYSTEMVALUES_COSMOSDB = TMP_DBSYSTEMVALUES_COSMOSDB;
    exports.DBSYSTEMVALUES_DYNAMODB = TMP_DBSYSTEMVALUES_DYNAMODB;
    exports.DBSYSTEMVALUES_NEO4J = TMP_DBSYSTEMVALUES_NEO4J;
    exports.DBSYSTEMVALUES_GEODE = TMP_DBSYSTEMVALUES_GEODE;
    exports.DBSYSTEMVALUES_ELASTICSEARCH = TMP_DBSYSTEMVALUES_ELASTICSEARCH;
    exports.DBSYSTEMVALUES_MEMCACHED = TMP_DBSYSTEMVALUES_MEMCACHED;
    exports.DBSYSTEMVALUES_COCKROACHDB = TMP_DBSYSTEMVALUES_COCKROACHDB;
    exports.DbSystemValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_DBSYSTEMVALUES_OTHER_SQL,
      TMP_DBSYSTEMVALUES_MSSQL,
      TMP_DBSYSTEMVALUES_MYSQL,
      TMP_DBSYSTEMVALUES_ORACLE,
      TMP_DBSYSTEMVALUES_DB2,
      TMP_DBSYSTEMVALUES_POSTGRESQL,
      TMP_DBSYSTEMVALUES_REDSHIFT,
      TMP_DBSYSTEMVALUES_HIVE,
      TMP_DBSYSTEMVALUES_CLOUDSCAPE,
      TMP_DBSYSTEMVALUES_HSQLDB,
      TMP_DBSYSTEMVALUES_PROGRESS,
      TMP_DBSYSTEMVALUES_MAXDB,
      TMP_DBSYSTEMVALUES_HANADB,
      TMP_DBSYSTEMVALUES_INGRES,
      TMP_DBSYSTEMVALUES_FIRSTSQL,
      TMP_DBSYSTEMVALUES_EDB,
      TMP_DBSYSTEMVALUES_CACHE,
      TMP_DBSYSTEMVALUES_ADABAS,
      TMP_DBSYSTEMVALUES_FIREBIRD,
      TMP_DBSYSTEMVALUES_DERBY,
      TMP_DBSYSTEMVALUES_FILEMAKER,
      TMP_DBSYSTEMVALUES_INFORMIX,
      TMP_DBSYSTEMVALUES_INSTANTDB,
      TMP_DBSYSTEMVALUES_INTERBASE,
      TMP_DBSYSTEMVALUES_MARIADB,
      TMP_DBSYSTEMVALUES_NETEZZA,
      TMP_DBSYSTEMVALUES_PERVASIVE,
      TMP_DBSYSTEMVALUES_POINTBASE,
      TMP_DBSYSTEMVALUES_SQLITE,
      TMP_DBSYSTEMVALUES_SYBASE,
      TMP_DBSYSTEMVALUES_TERADATA,
      TMP_DBSYSTEMVALUES_VERTICA,
      TMP_DBSYSTEMVALUES_H2,
      TMP_DBSYSTEMVALUES_COLDFUSION,
      TMP_DBSYSTEMVALUES_CASSANDRA,
      TMP_DBSYSTEMVALUES_HBASE,
      TMP_DBSYSTEMVALUES_MONGODB,
      TMP_DBSYSTEMVALUES_REDIS,
      TMP_DBSYSTEMVALUES_COUCHBASE,
      TMP_DBSYSTEMVALUES_COUCHDB,
      TMP_DBSYSTEMVALUES_COSMOSDB,
      TMP_DBSYSTEMVALUES_DYNAMODB,
      TMP_DBSYSTEMVALUES_NEO4J,
      TMP_DBSYSTEMVALUES_GEODE,
      TMP_DBSYSTEMVALUES_ELASTICSEARCH,
      TMP_DBSYSTEMVALUES_MEMCACHED,
      TMP_DBSYSTEMVALUES_COCKROACHDB
    ]);
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ALL = "all";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM = "each_quorum";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM = "quorum";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM = "local_quorum";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ONE = "one";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_TWO = "two";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_THREE = "three";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE = "local_one";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ANY = "any";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL = "serial";
    var TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL = "local_serial";
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_ALL = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ALL;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_ONE = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ONE;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_TWO = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_TWO;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_THREE = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_THREE;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_ANY = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ANY;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL;
    exports.DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL = TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL;
    exports.DbCassandraConsistencyLevelValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ALL,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_EACH_QUORUM,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_QUORUM,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_QUORUM,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ONE,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_TWO,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_THREE,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_ONE,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_ANY,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_SERIAL,
      TMP_DBCASSANDRACONSISTENCYLEVELVALUES_LOCAL_SERIAL
    ]);
    var TMP_FAASTRIGGERVALUES_DATASOURCE = "datasource";
    var TMP_FAASTRIGGERVALUES_HTTP = "http";
    var TMP_FAASTRIGGERVALUES_PUBSUB = "pubsub";
    var TMP_FAASTRIGGERVALUES_TIMER = "timer";
    var TMP_FAASTRIGGERVALUES_OTHER = "other";
    exports.FAASTRIGGERVALUES_DATASOURCE = TMP_FAASTRIGGERVALUES_DATASOURCE;
    exports.FAASTRIGGERVALUES_HTTP = TMP_FAASTRIGGERVALUES_HTTP;
    exports.FAASTRIGGERVALUES_PUBSUB = TMP_FAASTRIGGERVALUES_PUBSUB;
    exports.FAASTRIGGERVALUES_TIMER = TMP_FAASTRIGGERVALUES_TIMER;
    exports.FAASTRIGGERVALUES_OTHER = TMP_FAASTRIGGERVALUES_OTHER;
    exports.FaasTriggerValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_FAASTRIGGERVALUES_DATASOURCE,
      TMP_FAASTRIGGERVALUES_HTTP,
      TMP_FAASTRIGGERVALUES_PUBSUB,
      TMP_FAASTRIGGERVALUES_TIMER,
      TMP_FAASTRIGGERVALUES_OTHER
    ]);
    var TMP_FAASDOCUMENTOPERATIONVALUES_INSERT = "insert";
    var TMP_FAASDOCUMENTOPERATIONVALUES_EDIT = "edit";
    var TMP_FAASDOCUMENTOPERATIONVALUES_DELETE = "delete";
    exports.FAASDOCUMENTOPERATIONVALUES_INSERT = TMP_FAASDOCUMENTOPERATIONVALUES_INSERT;
    exports.FAASDOCUMENTOPERATIONVALUES_EDIT = TMP_FAASDOCUMENTOPERATIONVALUES_EDIT;
    exports.FAASDOCUMENTOPERATIONVALUES_DELETE = TMP_FAASDOCUMENTOPERATIONVALUES_DELETE;
    exports.FaasDocumentOperationValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_FAASDOCUMENTOPERATIONVALUES_INSERT,
      TMP_FAASDOCUMENTOPERATIONVALUES_EDIT,
      TMP_FAASDOCUMENTOPERATIONVALUES_DELETE
    ]);
    var TMP_FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD = "alibaba_cloud";
    var TMP_FAASINVOKEDPROVIDERVALUES_AWS = "aws";
    var TMP_FAASINVOKEDPROVIDERVALUES_AZURE = "azure";
    var TMP_FAASINVOKEDPROVIDERVALUES_GCP = "gcp";
    exports.FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD = TMP_FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD;
    exports.FAASINVOKEDPROVIDERVALUES_AWS = TMP_FAASINVOKEDPROVIDERVALUES_AWS;
    exports.FAASINVOKEDPROVIDERVALUES_AZURE = TMP_FAASINVOKEDPROVIDERVALUES_AZURE;
    exports.FAASINVOKEDPROVIDERVALUES_GCP = TMP_FAASINVOKEDPROVIDERVALUES_GCP;
    exports.FaasInvokedProviderValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_FAASINVOKEDPROVIDERVALUES_ALIBABA_CLOUD,
      TMP_FAASINVOKEDPROVIDERVALUES_AWS,
      TMP_FAASINVOKEDPROVIDERVALUES_AZURE,
      TMP_FAASINVOKEDPROVIDERVALUES_GCP
    ]);
    var TMP_NETTRANSPORTVALUES_IP_TCP = "ip_tcp";
    var TMP_NETTRANSPORTVALUES_IP_UDP = "ip_udp";
    var TMP_NETTRANSPORTVALUES_IP = "ip";
    var TMP_NETTRANSPORTVALUES_UNIX = "unix";
    var TMP_NETTRANSPORTVALUES_PIPE = "pipe";
    var TMP_NETTRANSPORTVALUES_INPROC = "inproc";
    var TMP_NETTRANSPORTVALUES_OTHER = "other";
    exports.NETTRANSPORTVALUES_IP_TCP = TMP_NETTRANSPORTVALUES_IP_TCP;
    exports.NETTRANSPORTVALUES_IP_UDP = TMP_NETTRANSPORTVALUES_IP_UDP;
    exports.NETTRANSPORTVALUES_IP = TMP_NETTRANSPORTVALUES_IP;
    exports.NETTRANSPORTVALUES_UNIX = TMP_NETTRANSPORTVALUES_UNIX;
    exports.NETTRANSPORTVALUES_PIPE = TMP_NETTRANSPORTVALUES_PIPE;
    exports.NETTRANSPORTVALUES_INPROC = TMP_NETTRANSPORTVALUES_INPROC;
    exports.NETTRANSPORTVALUES_OTHER = TMP_NETTRANSPORTVALUES_OTHER;
    exports.NetTransportValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_NETTRANSPORTVALUES_IP_TCP,
      TMP_NETTRANSPORTVALUES_IP_UDP,
      TMP_NETTRANSPORTVALUES_IP,
      TMP_NETTRANSPORTVALUES_UNIX,
      TMP_NETTRANSPORTVALUES_PIPE,
      TMP_NETTRANSPORTVALUES_INPROC,
      TMP_NETTRANSPORTVALUES_OTHER
    ]);
    var TMP_NETHOSTCONNECTIONTYPEVALUES_WIFI = "wifi";
    var TMP_NETHOSTCONNECTIONTYPEVALUES_WIRED = "wired";
    var TMP_NETHOSTCONNECTIONTYPEVALUES_CELL = "cell";
    var TMP_NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE = "unavailable";
    var TMP_NETHOSTCONNECTIONTYPEVALUES_UNKNOWN = "unknown";
    exports.NETHOSTCONNECTIONTYPEVALUES_WIFI = TMP_NETHOSTCONNECTIONTYPEVALUES_WIFI;
    exports.NETHOSTCONNECTIONTYPEVALUES_WIRED = TMP_NETHOSTCONNECTIONTYPEVALUES_WIRED;
    exports.NETHOSTCONNECTIONTYPEVALUES_CELL = TMP_NETHOSTCONNECTIONTYPEVALUES_CELL;
    exports.NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE = TMP_NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE;
    exports.NETHOSTCONNECTIONTYPEVALUES_UNKNOWN = TMP_NETHOSTCONNECTIONTYPEVALUES_UNKNOWN;
    exports.NetHostConnectionTypeValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_NETHOSTCONNECTIONTYPEVALUES_WIFI,
      TMP_NETHOSTCONNECTIONTYPEVALUES_WIRED,
      TMP_NETHOSTCONNECTIONTYPEVALUES_CELL,
      TMP_NETHOSTCONNECTIONTYPEVALUES_UNAVAILABLE,
      TMP_NETHOSTCONNECTIONTYPEVALUES_UNKNOWN
    ]);
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GPRS = "gprs";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EDGE = "edge";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_UMTS = "umts";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA = "cdma";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0 = "evdo_0";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A = "evdo_a";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT = "cdma2000_1xrtt";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA = "hsdpa";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA = "hsupa";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPA = "hspa";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IDEN = "iden";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B = "evdo_b";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE = "lte";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD = "ehrpd";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP = "hspap";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GSM = "gsm";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA = "td_scdma";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN = "iwlan";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NR = "nr";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA = "nrnsa";
    var TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA = "lte_ca";
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_GPRS = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GPRS;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_EDGE = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EDGE;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_UMTS = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_UMTS;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_CDMA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0 = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSPA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_IDEN = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IDEN;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_LTE = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_GSM = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GSM;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_NR = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NR;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA;
    exports.NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA = TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA;
    exports.NetHostConnectionSubtypeValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GPRS,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EDGE,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_UMTS,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_0,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_A,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_CDMA2000_1XRTT,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSDPA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSUPA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IDEN,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EVDO_B,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_EHRPD,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_HSPAP,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_GSM,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_TD_SCDMA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_IWLAN,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NR,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_NRNSA,
      TMP_NETHOSTCONNECTIONSUBTYPEVALUES_LTE_CA
    ]);
    var TMP_HTTPFLAVORVALUES_HTTP_1_0 = "1.0";
    var TMP_HTTPFLAVORVALUES_HTTP_1_1 = "1.1";
    var TMP_HTTPFLAVORVALUES_HTTP_2_0 = "2.0";
    var TMP_HTTPFLAVORVALUES_SPDY = "SPDY";
    var TMP_HTTPFLAVORVALUES_QUIC = "QUIC";
    exports.HTTPFLAVORVALUES_HTTP_1_0 = TMP_HTTPFLAVORVALUES_HTTP_1_0;
    exports.HTTPFLAVORVALUES_HTTP_1_1 = TMP_HTTPFLAVORVALUES_HTTP_1_1;
    exports.HTTPFLAVORVALUES_HTTP_2_0 = TMP_HTTPFLAVORVALUES_HTTP_2_0;
    exports.HTTPFLAVORVALUES_SPDY = TMP_HTTPFLAVORVALUES_SPDY;
    exports.HTTPFLAVORVALUES_QUIC = TMP_HTTPFLAVORVALUES_QUIC;
    exports.HttpFlavorValues = {
      HTTP_1_0: TMP_HTTPFLAVORVALUES_HTTP_1_0,
      HTTP_1_1: TMP_HTTPFLAVORVALUES_HTTP_1_1,
      HTTP_2_0: TMP_HTTPFLAVORVALUES_HTTP_2_0,
      SPDY: TMP_HTTPFLAVORVALUES_SPDY,
      QUIC: TMP_HTTPFLAVORVALUES_QUIC
    };
    var TMP_MESSAGINGDESTINATIONKINDVALUES_QUEUE = "queue";
    var TMP_MESSAGINGDESTINATIONKINDVALUES_TOPIC = "topic";
    exports.MESSAGINGDESTINATIONKINDVALUES_QUEUE = TMP_MESSAGINGDESTINATIONKINDVALUES_QUEUE;
    exports.MESSAGINGDESTINATIONKINDVALUES_TOPIC = TMP_MESSAGINGDESTINATIONKINDVALUES_TOPIC;
    exports.MessagingDestinationKindValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_MESSAGINGDESTINATIONKINDVALUES_QUEUE,
      TMP_MESSAGINGDESTINATIONKINDVALUES_TOPIC
    ]);
    var TMP_MESSAGINGOPERATIONVALUES_RECEIVE = "receive";
    var TMP_MESSAGINGOPERATIONVALUES_PROCESS = "process";
    exports.MESSAGINGOPERATIONVALUES_RECEIVE = TMP_MESSAGINGOPERATIONVALUES_RECEIVE;
    exports.MESSAGINGOPERATIONVALUES_PROCESS = TMP_MESSAGINGOPERATIONVALUES_PROCESS;
    exports.MessagingOperationValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_MESSAGINGOPERATIONVALUES_RECEIVE,
      TMP_MESSAGINGOPERATIONVALUES_PROCESS
    ]);
    var TMP_RPCGRPCSTATUSCODEVALUES_OK = 0;
    var TMP_RPCGRPCSTATUSCODEVALUES_CANCELLED = 1;
    var TMP_RPCGRPCSTATUSCODEVALUES_UNKNOWN = 2;
    var TMP_RPCGRPCSTATUSCODEVALUES_INVALID_ARGUMENT = 3;
    var TMP_RPCGRPCSTATUSCODEVALUES_DEADLINE_EXCEEDED = 4;
    var TMP_RPCGRPCSTATUSCODEVALUES_NOT_FOUND = 5;
    var TMP_RPCGRPCSTATUSCODEVALUES_ALREADY_EXISTS = 6;
    var TMP_RPCGRPCSTATUSCODEVALUES_PERMISSION_DENIED = 7;
    var TMP_RPCGRPCSTATUSCODEVALUES_RESOURCE_EXHAUSTED = 8;
    var TMP_RPCGRPCSTATUSCODEVALUES_FAILED_PRECONDITION = 9;
    var TMP_RPCGRPCSTATUSCODEVALUES_ABORTED = 10;
    var TMP_RPCGRPCSTATUSCODEVALUES_OUT_OF_RANGE = 11;
    var TMP_RPCGRPCSTATUSCODEVALUES_UNIMPLEMENTED = 12;
    var TMP_RPCGRPCSTATUSCODEVALUES_INTERNAL = 13;
    var TMP_RPCGRPCSTATUSCODEVALUES_UNAVAILABLE = 14;
    var TMP_RPCGRPCSTATUSCODEVALUES_DATA_LOSS = 15;
    var TMP_RPCGRPCSTATUSCODEVALUES_UNAUTHENTICATED = 16;
    exports.RPCGRPCSTATUSCODEVALUES_OK = TMP_RPCGRPCSTATUSCODEVALUES_OK;
    exports.RPCGRPCSTATUSCODEVALUES_CANCELLED = TMP_RPCGRPCSTATUSCODEVALUES_CANCELLED;
    exports.RPCGRPCSTATUSCODEVALUES_UNKNOWN = TMP_RPCGRPCSTATUSCODEVALUES_UNKNOWN;
    exports.RPCGRPCSTATUSCODEVALUES_INVALID_ARGUMENT = TMP_RPCGRPCSTATUSCODEVALUES_INVALID_ARGUMENT;
    exports.RPCGRPCSTATUSCODEVALUES_DEADLINE_EXCEEDED = TMP_RPCGRPCSTATUSCODEVALUES_DEADLINE_EXCEEDED;
    exports.RPCGRPCSTATUSCODEVALUES_NOT_FOUND = TMP_RPCGRPCSTATUSCODEVALUES_NOT_FOUND;
    exports.RPCGRPCSTATUSCODEVALUES_ALREADY_EXISTS = TMP_RPCGRPCSTATUSCODEVALUES_ALREADY_EXISTS;
    exports.RPCGRPCSTATUSCODEVALUES_PERMISSION_DENIED = TMP_RPCGRPCSTATUSCODEVALUES_PERMISSION_DENIED;
    exports.RPCGRPCSTATUSCODEVALUES_RESOURCE_EXHAUSTED = TMP_RPCGRPCSTATUSCODEVALUES_RESOURCE_EXHAUSTED;
    exports.RPCGRPCSTATUSCODEVALUES_FAILED_PRECONDITION = TMP_RPCGRPCSTATUSCODEVALUES_FAILED_PRECONDITION;
    exports.RPCGRPCSTATUSCODEVALUES_ABORTED = TMP_RPCGRPCSTATUSCODEVALUES_ABORTED;
    exports.RPCGRPCSTATUSCODEVALUES_OUT_OF_RANGE = TMP_RPCGRPCSTATUSCODEVALUES_OUT_OF_RANGE;
    exports.RPCGRPCSTATUSCODEVALUES_UNIMPLEMENTED = TMP_RPCGRPCSTATUSCODEVALUES_UNIMPLEMENTED;
    exports.RPCGRPCSTATUSCODEVALUES_INTERNAL = TMP_RPCGRPCSTATUSCODEVALUES_INTERNAL;
    exports.RPCGRPCSTATUSCODEVALUES_UNAVAILABLE = TMP_RPCGRPCSTATUSCODEVALUES_UNAVAILABLE;
    exports.RPCGRPCSTATUSCODEVALUES_DATA_LOSS = TMP_RPCGRPCSTATUSCODEVALUES_DATA_LOSS;
    exports.RPCGRPCSTATUSCODEVALUES_UNAUTHENTICATED = TMP_RPCGRPCSTATUSCODEVALUES_UNAUTHENTICATED;
    exports.RpcGrpcStatusCodeValues = {
      OK: TMP_RPCGRPCSTATUSCODEVALUES_OK,
      CANCELLED: TMP_RPCGRPCSTATUSCODEVALUES_CANCELLED,
      UNKNOWN: TMP_RPCGRPCSTATUSCODEVALUES_UNKNOWN,
      INVALID_ARGUMENT: TMP_RPCGRPCSTATUSCODEVALUES_INVALID_ARGUMENT,
      DEADLINE_EXCEEDED: TMP_RPCGRPCSTATUSCODEVALUES_DEADLINE_EXCEEDED,
      NOT_FOUND: TMP_RPCGRPCSTATUSCODEVALUES_NOT_FOUND,
      ALREADY_EXISTS: TMP_RPCGRPCSTATUSCODEVALUES_ALREADY_EXISTS,
      PERMISSION_DENIED: TMP_RPCGRPCSTATUSCODEVALUES_PERMISSION_DENIED,
      RESOURCE_EXHAUSTED: TMP_RPCGRPCSTATUSCODEVALUES_RESOURCE_EXHAUSTED,
      FAILED_PRECONDITION: TMP_RPCGRPCSTATUSCODEVALUES_FAILED_PRECONDITION,
      ABORTED: TMP_RPCGRPCSTATUSCODEVALUES_ABORTED,
      OUT_OF_RANGE: TMP_RPCGRPCSTATUSCODEVALUES_OUT_OF_RANGE,
      UNIMPLEMENTED: TMP_RPCGRPCSTATUSCODEVALUES_UNIMPLEMENTED,
      INTERNAL: TMP_RPCGRPCSTATUSCODEVALUES_INTERNAL,
      UNAVAILABLE: TMP_RPCGRPCSTATUSCODEVALUES_UNAVAILABLE,
      DATA_LOSS: TMP_RPCGRPCSTATUSCODEVALUES_DATA_LOSS,
      UNAUTHENTICATED: TMP_RPCGRPCSTATUSCODEVALUES_UNAUTHENTICATED
    };
    var TMP_MESSAGETYPEVALUES_SENT = "SENT";
    var TMP_MESSAGETYPEVALUES_RECEIVED = "RECEIVED";
    exports.MESSAGETYPEVALUES_SENT = TMP_MESSAGETYPEVALUES_SENT;
    exports.MESSAGETYPEVALUES_RECEIVED = TMP_MESSAGETYPEVALUES_RECEIVED;
    exports.MessageTypeValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_MESSAGETYPEVALUES_SENT,
      TMP_MESSAGETYPEVALUES_RECEIVED
    ]);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/trace/index.js
var require_trace2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/trace/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: /* @__PURE__ */ __name(function() {
          return m[k];
        }, "get") };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_SemanticAttributes(), exports);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/resource/SemanticResourceAttributes.js
var require_SemanticResourceAttributes = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/resource/SemanticResourceAttributes.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SEMRESATTRS_K8S_STATEFULSET_NAME = exports.SEMRESATTRS_K8S_STATEFULSET_UID = exports.SEMRESATTRS_K8S_DEPLOYMENT_NAME = exports.SEMRESATTRS_K8S_DEPLOYMENT_UID = exports.SEMRESATTRS_K8S_REPLICASET_NAME = exports.SEMRESATTRS_K8S_REPLICASET_UID = exports.SEMRESATTRS_K8S_CONTAINER_NAME = exports.SEMRESATTRS_K8S_POD_NAME = exports.SEMRESATTRS_K8S_POD_UID = exports.SEMRESATTRS_K8S_NAMESPACE_NAME = exports.SEMRESATTRS_K8S_NODE_UID = exports.SEMRESATTRS_K8S_NODE_NAME = exports.SEMRESATTRS_K8S_CLUSTER_NAME = exports.SEMRESATTRS_HOST_IMAGE_VERSION = exports.SEMRESATTRS_HOST_IMAGE_ID = exports.SEMRESATTRS_HOST_IMAGE_NAME = exports.SEMRESATTRS_HOST_ARCH = exports.SEMRESATTRS_HOST_TYPE = exports.SEMRESATTRS_HOST_NAME = exports.SEMRESATTRS_HOST_ID = exports.SEMRESATTRS_FAAS_MAX_MEMORY = exports.SEMRESATTRS_FAAS_INSTANCE = exports.SEMRESATTRS_FAAS_VERSION = exports.SEMRESATTRS_FAAS_ID = exports.SEMRESATTRS_FAAS_NAME = exports.SEMRESATTRS_DEVICE_MODEL_NAME = exports.SEMRESATTRS_DEVICE_MODEL_IDENTIFIER = exports.SEMRESATTRS_DEVICE_ID = exports.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT = exports.SEMRESATTRS_CONTAINER_IMAGE_TAG = exports.SEMRESATTRS_CONTAINER_IMAGE_NAME = exports.SEMRESATTRS_CONTAINER_RUNTIME = exports.SEMRESATTRS_CONTAINER_ID = exports.SEMRESATTRS_CONTAINER_NAME = exports.SEMRESATTRS_AWS_LOG_STREAM_ARNS = exports.SEMRESATTRS_AWS_LOG_STREAM_NAMES = exports.SEMRESATTRS_AWS_LOG_GROUP_ARNS = exports.SEMRESATTRS_AWS_LOG_GROUP_NAMES = exports.SEMRESATTRS_AWS_EKS_CLUSTER_ARN = exports.SEMRESATTRS_AWS_ECS_TASK_REVISION = exports.SEMRESATTRS_AWS_ECS_TASK_FAMILY = exports.SEMRESATTRS_AWS_ECS_TASK_ARN = exports.SEMRESATTRS_AWS_ECS_LAUNCHTYPE = exports.SEMRESATTRS_AWS_ECS_CLUSTER_ARN = exports.SEMRESATTRS_AWS_ECS_CONTAINER_ARN = exports.SEMRESATTRS_CLOUD_PLATFORM = exports.SEMRESATTRS_CLOUD_AVAILABILITY_ZONE = exports.SEMRESATTRS_CLOUD_REGION = exports.SEMRESATTRS_CLOUD_ACCOUNT_ID = exports.SEMRESATTRS_CLOUD_PROVIDER = void 0;
    exports.CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE = exports.CLOUDPLATFORMVALUES_AZURE_APP_SERVICE = exports.CLOUDPLATFORMVALUES_AZURE_FUNCTIONS = exports.CLOUDPLATFORMVALUES_AZURE_AKS = exports.CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES = exports.CLOUDPLATFORMVALUES_AZURE_VM = exports.CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK = exports.CLOUDPLATFORMVALUES_AWS_LAMBDA = exports.CLOUDPLATFORMVALUES_AWS_EKS = exports.CLOUDPLATFORMVALUES_AWS_ECS = exports.CLOUDPLATFORMVALUES_AWS_EC2 = exports.CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC = exports.CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS = exports.CloudProviderValues = exports.CLOUDPROVIDERVALUES_GCP = exports.CLOUDPROVIDERVALUES_AZURE = exports.CLOUDPROVIDERVALUES_AWS = exports.CLOUDPROVIDERVALUES_ALIBABA_CLOUD = exports.SemanticResourceAttributes = exports.SEMRESATTRS_WEBENGINE_DESCRIPTION = exports.SEMRESATTRS_WEBENGINE_VERSION = exports.SEMRESATTRS_WEBENGINE_NAME = exports.SEMRESATTRS_TELEMETRY_AUTO_VERSION = exports.SEMRESATTRS_TELEMETRY_SDK_VERSION = exports.SEMRESATTRS_TELEMETRY_SDK_LANGUAGE = exports.SEMRESATTRS_TELEMETRY_SDK_NAME = exports.SEMRESATTRS_SERVICE_VERSION = exports.SEMRESATTRS_SERVICE_INSTANCE_ID = exports.SEMRESATTRS_SERVICE_NAMESPACE = exports.SEMRESATTRS_SERVICE_NAME = exports.SEMRESATTRS_PROCESS_RUNTIME_DESCRIPTION = exports.SEMRESATTRS_PROCESS_RUNTIME_VERSION = exports.SEMRESATTRS_PROCESS_RUNTIME_NAME = exports.SEMRESATTRS_PROCESS_OWNER = exports.SEMRESATTRS_PROCESS_COMMAND_ARGS = exports.SEMRESATTRS_PROCESS_COMMAND_LINE = exports.SEMRESATTRS_PROCESS_COMMAND = exports.SEMRESATTRS_PROCESS_EXECUTABLE_PATH = exports.SEMRESATTRS_PROCESS_EXECUTABLE_NAME = exports.SEMRESATTRS_PROCESS_PID = exports.SEMRESATTRS_OS_VERSION = exports.SEMRESATTRS_OS_NAME = exports.SEMRESATTRS_OS_DESCRIPTION = exports.SEMRESATTRS_OS_TYPE = exports.SEMRESATTRS_K8S_CRONJOB_NAME = exports.SEMRESATTRS_K8S_CRONJOB_UID = exports.SEMRESATTRS_K8S_JOB_NAME = exports.SEMRESATTRS_K8S_JOB_UID = exports.SEMRESATTRS_K8S_DAEMONSET_NAME = exports.SEMRESATTRS_K8S_DAEMONSET_UID = void 0;
    exports.TelemetrySdkLanguageValues = exports.TELEMETRYSDKLANGUAGEVALUES_WEBJS = exports.TELEMETRYSDKLANGUAGEVALUES_RUBY = exports.TELEMETRYSDKLANGUAGEVALUES_PYTHON = exports.TELEMETRYSDKLANGUAGEVALUES_PHP = exports.TELEMETRYSDKLANGUAGEVALUES_NODEJS = exports.TELEMETRYSDKLANGUAGEVALUES_JAVA = exports.TELEMETRYSDKLANGUAGEVALUES_GO = exports.TELEMETRYSDKLANGUAGEVALUES_ERLANG = exports.TELEMETRYSDKLANGUAGEVALUES_DOTNET = exports.TELEMETRYSDKLANGUAGEVALUES_CPP = exports.OsTypeValues = exports.OSTYPEVALUES_Z_OS = exports.OSTYPEVALUES_SOLARIS = exports.OSTYPEVALUES_AIX = exports.OSTYPEVALUES_HPUX = exports.OSTYPEVALUES_DRAGONFLYBSD = exports.OSTYPEVALUES_OPENBSD = exports.OSTYPEVALUES_NETBSD = exports.OSTYPEVALUES_FREEBSD = exports.OSTYPEVALUES_DARWIN = exports.OSTYPEVALUES_LINUX = exports.OSTYPEVALUES_WINDOWS = exports.HostArchValues = exports.HOSTARCHVALUES_X86 = exports.HOSTARCHVALUES_PPC64 = exports.HOSTARCHVALUES_PPC32 = exports.HOSTARCHVALUES_IA64 = exports.HOSTARCHVALUES_ARM64 = exports.HOSTARCHVALUES_ARM32 = exports.HOSTARCHVALUES_AMD64 = exports.AwsEcsLaunchtypeValues = exports.AWSECSLAUNCHTYPEVALUES_FARGATE = exports.AWSECSLAUNCHTYPEVALUES_EC2 = exports.CloudPlatformValues = exports.CLOUDPLATFORMVALUES_GCP_APP_ENGINE = exports.CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS = exports.CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE = exports.CLOUDPLATFORMVALUES_GCP_CLOUD_RUN = void 0;
    var utils_1 = require_utils4();
    var TMP_CLOUD_PROVIDER = "cloud.provider";
    var TMP_CLOUD_ACCOUNT_ID = "cloud.account.id";
    var TMP_CLOUD_REGION = "cloud.region";
    var TMP_CLOUD_AVAILABILITY_ZONE = "cloud.availability_zone";
    var TMP_CLOUD_PLATFORM = "cloud.platform";
    var TMP_AWS_ECS_CONTAINER_ARN = "aws.ecs.container.arn";
    var TMP_AWS_ECS_CLUSTER_ARN = "aws.ecs.cluster.arn";
    var TMP_AWS_ECS_LAUNCHTYPE = "aws.ecs.launchtype";
    var TMP_AWS_ECS_TASK_ARN = "aws.ecs.task.arn";
    var TMP_AWS_ECS_TASK_FAMILY = "aws.ecs.task.family";
    var TMP_AWS_ECS_TASK_REVISION = "aws.ecs.task.revision";
    var TMP_AWS_EKS_CLUSTER_ARN = "aws.eks.cluster.arn";
    var TMP_AWS_LOG_GROUP_NAMES = "aws.log.group.names";
    var TMP_AWS_LOG_GROUP_ARNS = "aws.log.group.arns";
    var TMP_AWS_LOG_STREAM_NAMES = "aws.log.stream.names";
    var TMP_AWS_LOG_STREAM_ARNS = "aws.log.stream.arns";
    var TMP_CONTAINER_NAME = "container.name";
    var TMP_CONTAINER_ID = "container.id";
    var TMP_CONTAINER_RUNTIME = "container.runtime";
    var TMP_CONTAINER_IMAGE_NAME = "container.image.name";
    var TMP_CONTAINER_IMAGE_TAG = "container.image.tag";
    var TMP_DEPLOYMENT_ENVIRONMENT = "deployment.environment";
    var TMP_DEVICE_ID = "device.id";
    var TMP_DEVICE_MODEL_IDENTIFIER = "device.model.identifier";
    var TMP_DEVICE_MODEL_NAME = "device.model.name";
    var TMP_FAAS_NAME = "faas.name";
    var TMP_FAAS_ID = "faas.id";
    var TMP_FAAS_VERSION = "faas.version";
    var TMP_FAAS_INSTANCE = "faas.instance";
    var TMP_FAAS_MAX_MEMORY = "faas.max_memory";
    var TMP_HOST_ID = "host.id";
    var TMP_HOST_NAME = "host.name";
    var TMP_HOST_TYPE = "host.type";
    var TMP_HOST_ARCH = "host.arch";
    var TMP_HOST_IMAGE_NAME = "host.image.name";
    var TMP_HOST_IMAGE_ID = "host.image.id";
    var TMP_HOST_IMAGE_VERSION = "host.image.version";
    var TMP_K8S_CLUSTER_NAME = "k8s.cluster.name";
    var TMP_K8S_NODE_NAME = "k8s.node.name";
    var TMP_K8S_NODE_UID = "k8s.node.uid";
    var TMP_K8S_NAMESPACE_NAME = "k8s.namespace.name";
    var TMP_K8S_POD_UID = "k8s.pod.uid";
    var TMP_K8S_POD_NAME = "k8s.pod.name";
    var TMP_K8S_CONTAINER_NAME = "k8s.container.name";
    var TMP_K8S_REPLICASET_UID = "k8s.replicaset.uid";
    var TMP_K8S_REPLICASET_NAME = "k8s.replicaset.name";
    var TMP_K8S_DEPLOYMENT_UID = "k8s.deployment.uid";
    var TMP_K8S_DEPLOYMENT_NAME = "k8s.deployment.name";
    var TMP_K8S_STATEFULSET_UID = "k8s.statefulset.uid";
    var TMP_K8S_STATEFULSET_NAME = "k8s.statefulset.name";
    var TMP_K8S_DAEMONSET_UID = "k8s.daemonset.uid";
    var TMP_K8S_DAEMONSET_NAME = "k8s.daemonset.name";
    var TMP_K8S_JOB_UID = "k8s.job.uid";
    var TMP_K8S_JOB_NAME = "k8s.job.name";
    var TMP_K8S_CRONJOB_UID = "k8s.cronjob.uid";
    var TMP_K8S_CRONJOB_NAME = "k8s.cronjob.name";
    var TMP_OS_TYPE = "os.type";
    var TMP_OS_DESCRIPTION = "os.description";
    var TMP_OS_NAME = "os.name";
    var TMP_OS_VERSION = "os.version";
    var TMP_PROCESS_PID = "process.pid";
    var TMP_PROCESS_EXECUTABLE_NAME = "process.executable.name";
    var TMP_PROCESS_EXECUTABLE_PATH = "process.executable.path";
    var TMP_PROCESS_COMMAND = "process.command";
    var TMP_PROCESS_COMMAND_LINE = "process.command_line";
    var TMP_PROCESS_COMMAND_ARGS = "process.command_args";
    var TMP_PROCESS_OWNER = "process.owner";
    var TMP_PROCESS_RUNTIME_NAME = "process.runtime.name";
    var TMP_PROCESS_RUNTIME_VERSION = "process.runtime.version";
    var TMP_PROCESS_RUNTIME_DESCRIPTION = "process.runtime.description";
    var TMP_SERVICE_NAME = "service.name";
    var TMP_SERVICE_NAMESPACE = "service.namespace";
    var TMP_SERVICE_INSTANCE_ID = "service.instance.id";
    var TMP_SERVICE_VERSION = "service.version";
    var TMP_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
    var TMP_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
    var TMP_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
    var TMP_TELEMETRY_AUTO_VERSION = "telemetry.auto.version";
    var TMP_WEBENGINE_NAME = "webengine.name";
    var TMP_WEBENGINE_VERSION = "webengine.version";
    var TMP_WEBENGINE_DESCRIPTION = "webengine.description";
    exports.SEMRESATTRS_CLOUD_PROVIDER = TMP_CLOUD_PROVIDER;
    exports.SEMRESATTRS_CLOUD_ACCOUNT_ID = TMP_CLOUD_ACCOUNT_ID;
    exports.SEMRESATTRS_CLOUD_REGION = TMP_CLOUD_REGION;
    exports.SEMRESATTRS_CLOUD_AVAILABILITY_ZONE = TMP_CLOUD_AVAILABILITY_ZONE;
    exports.SEMRESATTRS_CLOUD_PLATFORM = TMP_CLOUD_PLATFORM;
    exports.SEMRESATTRS_AWS_ECS_CONTAINER_ARN = TMP_AWS_ECS_CONTAINER_ARN;
    exports.SEMRESATTRS_AWS_ECS_CLUSTER_ARN = TMP_AWS_ECS_CLUSTER_ARN;
    exports.SEMRESATTRS_AWS_ECS_LAUNCHTYPE = TMP_AWS_ECS_LAUNCHTYPE;
    exports.SEMRESATTRS_AWS_ECS_TASK_ARN = TMP_AWS_ECS_TASK_ARN;
    exports.SEMRESATTRS_AWS_ECS_TASK_FAMILY = TMP_AWS_ECS_TASK_FAMILY;
    exports.SEMRESATTRS_AWS_ECS_TASK_REVISION = TMP_AWS_ECS_TASK_REVISION;
    exports.SEMRESATTRS_AWS_EKS_CLUSTER_ARN = TMP_AWS_EKS_CLUSTER_ARN;
    exports.SEMRESATTRS_AWS_LOG_GROUP_NAMES = TMP_AWS_LOG_GROUP_NAMES;
    exports.SEMRESATTRS_AWS_LOG_GROUP_ARNS = TMP_AWS_LOG_GROUP_ARNS;
    exports.SEMRESATTRS_AWS_LOG_STREAM_NAMES = TMP_AWS_LOG_STREAM_NAMES;
    exports.SEMRESATTRS_AWS_LOG_STREAM_ARNS = TMP_AWS_LOG_STREAM_ARNS;
    exports.SEMRESATTRS_CONTAINER_NAME = TMP_CONTAINER_NAME;
    exports.SEMRESATTRS_CONTAINER_ID = TMP_CONTAINER_ID;
    exports.SEMRESATTRS_CONTAINER_RUNTIME = TMP_CONTAINER_RUNTIME;
    exports.SEMRESATTRS_CONTAINER_IMAGE_NAME = TMP_CONTAINER_IMAGE_NAME;
    exports.SEMRESATTRS_CONTAINER_IMAGE_TAG = TMP_CONTAINER_IMAGE_TAG;
    exports.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT = TMP_DEPLOYMENT_ENVIRONMENT;
    exports.SEMRESATTRS_DEVICE_ID = TMP_DEVICE_ID;
    exports.SEMRESATTRS_DEVICE_MODEL_IDENTIFIER = TMP_DEVICE_MODEL_IDENTIFIER;
    exports.SEMRESATTRS_DEVICE_MODEL_NAME = TMP_DEVICE_MODEL_NAME;
    exports.SEMRESATTRS_FAAS_NAME = TMP_FAAS_NAME;
    exports.SEMRESATTRS_FAAS_ID = TMP_FAAS_ID;
    exports.SEMRESATTRS_FAAS_VERSION = TMP_FAAS_VERSION;
    exports.SEMRESATTRS_FAAS_INSTANCE = TMP_FAAS_INSTANCE;
    exports.SEMRESATTRS_FAAS_MAX_MEMORY = TMP_FAAS_MAX_MEMORY;
    exports.SEMRESATTRS_HOST_ID = TMP_HOST_ID;
    exports.SEMRESATTRS_HOST_NAME = TMP_HOST_NAME;
    exports.SEMRESATTRS_HOST_TYPE = TMP_HOST_TYPE;
    exports.SEMRESATTRS_HOST_ARCH = TMP_HOST_ARCH;
    exports.SEMRESATTRS_HOST_IMAGE_NAME = TMP_HOST_IMAGE_NAME;
    exports.SEMRESATTRS_HOST_IMAGE_ID = TMP_HOST_IMAGE_ID;
    exports.SEMRESATTRS_HOST_IMAGE_VERSION = TMP_HOST_IMAGE_VERSION;
    exports.SEMRESATTRS_K8S_CLUSTER_NAME = TMP_K8S_CLUSTER_NAME;
    exports.SEMRESATTRS_K8S_NODE_NAME = TMP_K8S_NODE_NAME;
    exports.SEMRESATTRS_K8S_NODE_UID = TMP_K8S_NODE_UID;
    exports.SEMRESATTRS_K8S_NAMESPACE_NAME = TMP_K8S_NAMESPACE_NAME;
    exports.SEMRESATTRS_K8S_POD_UID = TMP_K8S_POD_UID;
    exports.SEMRESATTRS_K8S_POD_NAME = TMP_K8S_POD_NAME;
    exports.SEMRESATTRS_K8S_CONTAINER_NAME = TMP_K8S_CONTAINER_NAME;
    exports.SEMRESATTRS_K8S_REPLICASET_UID = TMP_K8S_REPLICASET_UID;
    exports.SEMRESATTRS_K8S_REPLICASET_NAME = TMP_K8S_REPLICASET_NAME;
    exports.SEMRESATTRS_K8S_DEPLOYMENT_UID = TMP_K8S_DEPLOYMENT_UID;
    exports.SEMRESATTRS_K8S_DEPLOYMENT_NAME = TMP_K8S_DEPLOYMENT_NAME;
    exports.SEMRESATTRS_K8S_STATEFULSET_UID = TMP_K8S_STATEFULSET_UID;
    exports.SEMRESATTRS_K8S_STATEFULSET_NAME = TMP_K8S_STATEFULSET_NAME;
    exports.SEMRESATTRS_K8S_DAEMONSET_UID = TMP_K8S_DAEMONSET_UID;
    exports.SEMRESATTRS_K8S_DAEMONSET_NAME = TMP_K8S_DAEMONSET_NAME;
    exports.SEMRESATTRS_K8S_JOB_UID = TMP_K8S_JOB_UID;
    exports.SEMRESATTRS_K8S_JOB_NAME = TMP_K8S_JOB_NAME;
    exports.SEMRESATTRS_K8S_CRONJOB_UID = TMP_K8S_CRONJOB_UID;
    exports.SEMRESATTRS_K8S_CRONJOB_NAME = TMP_K8S_CRONJOB_NAME;
    exports.SEMRESATTRS_OS_TYPE = TMP_OS_TYPE;
    exports.SEMRESATTRS_OS_DESCRIPTION = TMP_OS_DESCRIPTION;
    exports.SEMRESATTRS_OS_NAME = TMP_OS_NAME;
    exports.SEMRESATTRS_OS_VERSION = TMP_OS_VERSION;
    exports.SEMRESATTRS_PROCESS_PID = TMP_PROCESS_PID;
    exports.SEMRESATTRS_PROCESS_EXECUTABLE_NAME = TMP_PROCESS_EXECUTABLE_NAME;
    exports.SEMRESATTRS_PROCESS_EXECUTABLE_PATH = TMP_PROCESS_EXECUTABLE_PATH;
    exports.SEMRESATTRS_PROCESS_COMMAND = TMP_PROCESS_COMMAND;
    exports.SEMRESATTRS_PROCESS_COMMAND_LINE = TMP_PROCESS_COMMAND_LINE;
    exports.SEMRESATTRS_PROCESS_COMMAND_ARGS = TMP_PROCESS_COMMAND_ARGS;
    exports.SEMRESATTRS_PROCESS_OWNER = TMP_PROCESS_OWNER;
    exports.SEMRESATTRS_PROCESS_RUNTIME_NAME = TMP_PROCESS_RUNTIME_NAME;
    exports.SEMRESATTRS_PROCESS_RUNTIME_VERSION = TMP_PROCESS_RUNTIME_VERSION;
    exports.SEMRESATTRS_PROCESS_RUNTIME_DESCRIPTION = TMP_PROCESS_RUNTIME_DESCRIPTION;
    exports.SEMRESATTRS_SERVICE_NAME = TMP_SERVICE_NAME;
    exports.SEMRESATTRS_SERVICE_NAMESPACE = TMP_SERVICE_NAMESPACE;
    exports.SEMRESATTRS_SERVICE_INSTANCE_ID = TMP_SERVICE_INSTANCE_ID;
    exports.SEMRESATTRS_SERVICE_VERSION = TMP_SERVICE_VERSION;
    exports.SEMRESATTRS_TELEMETRY_SDK_NAME = TMP_TELEMETRY_SDK_NAME;
    exports.SEMRESATTRS_TELEMETRY_SDK_LANGUAGE = TMP_TELEMETRY_SDK_LANGUAGE;
    exports.SEMRESATTRS_TELEMETRY_SDK_VERSION = TMP_TELEMETRY_SDK_VERSION;
    exports.SEMRESATTRS_TELEMETRY_AUTO_VERSION = TMP_TELEMETRY_AUTO_VERSION;
    exports.SEMRESATTRS_WEBENGINE_NAME = TMP_WEBENGINE_NAME;
    exports.SEMRESATTRS_WEBENGINE_VERSION = TMP_WEBENGINE_VERSION;
    exports.SEMRESATTRS_WEBENGINE_DESCRIPTION = TMP_WEBENGINE_DESCRIPTION;
    exports.SemanticResourceAttributes = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_CLOUD_PROVIDER,
      TMP_CLOUD_ACCOUNT_ID,
      TMP_CLOUD_REGION,
      TMP_CLOUD_AVAILABILITY_ZONE,
      TMP_CLOUD_PLATFORM,
      TMP_AWS_ECS_CONTAINER_ARN,
      TMP_AWS_ECS_CLUSTER_ARN,
      TMP_AWS_ECS_LAUNCHTYPE,
      TMP_AWS_ECS_TASK_ARN,
      TMP_AWS_ECS_TASK_FAMILY,
      TMP_AWS_ECS_TASK_REVISION,
      TMP_AWS_EKS_CLUSTER_ARN,
      TMP_AWS_LOG_GROUP_NAMES,
      TMP_AWS_LOG_GROUP_ARNS,
      TMP_AWS_LOG_STREAM_NAMES,
      TMP_AWS_LOG_STREAM_ARNS,
      TMP_CONTAINER_NAME,
      TMP_CONTAINER_ID,
      TMP_CONTAINER_RUNTIME,
      TMP_CONTAINER_IMAGE_NAME,
      TMP_CONTAINER_IMAGE_TAG,
      TMP_DEPLOYMENT_ENVIRONMENT,
      TMP_DEVICE_ID,
      TMP_DEVICE_MODEL_IDENTIFIER,
      TMP_DEVICE_MODEL_NAME,
      TMP_FAAS_NAME,
      TMP_FAAS_ID,
      TMP_FAAS_VERSION,
      TMP_FAAS_INSTANCE,
      TMP_FAAS_MAX_MEMORY,
      TMP_HOST_ID,
      TMP_HOST_NAME,
      TMP_HOST_TYPE,
      TMP_HOST_ARCH,
      TMP_HOST_IMAGE_NAME,
      TMP_HOST_IMAGE_ID,
      TMP_HOST_IMAGE_VERSION,
      TMP_K8S_CLUSTER_NAME,
      TMP_K8S_NODE_NAME,
      TMP_K8S_NODE_UID,
      TMP_K8S_NAMESPACE_NAME,
      TMP_K8S_POD_UID,
      TMP_K8S_POD_NAME,
      TMP_K8S_CONTAINER_NAME,
      TMP_K8S_REPLICASET_UID,
      TMP_K8S_REPLICASET_NAME,
      TMP_K8S_DEPLOYMENT_UID,
      TMP_K8S_DEPLOYMENT_NAME,
      TMP_K8S_STATEFULSET_UID,
      TMP_K8S_STATEFULSET_NAME,
      TMP_K8S_DAEMONSET_UID,
      TMP_K8S_DAEMONSET_NAME,
      TMP_K8S_JOB_UID,
      TMP_K8S_JOB_NAME,
      TMP_K8S_CRONJOB_UID,
      TMP_K8S_CRONJOB_NAME,
      TMP_OS_TYPE,
      TMP_OS_DESCRIPTION,
      TMP_OS_NAME,
      TMP_OS_VERSION,
      TMP_PROCESS_PID,
      TMP_PROCESS_EXECUTABLE_NAME,
      TMP_PROCESS_EXECUTABLE_PATH,
      TMP_PROCESS_COMMAND,
      TMP_PROCESS_COMMAND_LINE,
      TMP_PROCESS_COMMAND_ARGS,
      TMP_PROCESS_OWNER,
      TMP_PROCESS_RUNTIME_NAME,
      TMP_PROCESS_RUNTIME_VERSION,
      TMP_PROCESS_RUNTIME_DESCRIPTION,
      TMP_SERVICE_NAME,
      TMP_SERVICE_NAMESPACE,
      TMP_SERVICE_INSTANCE_ID,
      TMP_SERVICE_VERSION,
      TMP_TELEMETRY_SDK_NAME,
      TMP_TELEMETRY_SDK_LANGUAGE,
      TMP_TELEMETRY_SDK_VERSION,
      TMP_TELEMETRY_AUTO_VERSION,
      TMP_WEBENGINE_NAME,
      TMP_WEBENGINE_VERSION,
      TMP_WEBENGINE_DESCRIPTION
    ]);
    var TMP_CLOUDPROVIDERVALUES_ALIBABA_CLOUD = "alibaba_cloud";
    var TMP_CLOUDPROVIDERVALUES_AWS = "aws";
    var TMP_CLOUDPROVIDERVALUES_AZURE = "azure";
    var TMP_CLOUDPROVIDERVALUES_GCP = "gcp";
    exports.CLOUDPROVIDERVALUES_ALIBABA_CLOUD = TMP_CLOUDPROVIDERVALUES_ALIBABA_CLOUD;
    exports.CLOUDPROVIDERVALUES_AWS = TMP_CLOUDPROVIDERVALUES_AWS;
    exports.CLOUDPROVIDERVALUES_AZURE = TMP_CLOUDPROVIDERVALUES_AZURE;
    exports.CLOUDPROVIDERVALUES_GCP = TMP_CLOUDPROVIDERVALUES_GCP;
    exports.CloudProviderValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_CLOUDPROVIDERVALUES_ALIBABA_CLOUD,
      TMP_CLOUDPROVIDERVALUES_AWS,
      TMP_CLOUDPROVIDERVALUES_AZURE,
      TMP_CLOUDPROVIDERVALUES_GCP
    ]);
    var TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS = "alibaba_cloud_ecs";
    var TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC = "alibaba_cloud_fc";
    var TMP_CLOUDPLATFORMVALUES_AWS_EC2 = "aws_ec2";
    var TMP_CLOUDPLATFORMVALUES_AWS_ECS = "aws_ecs";
    var TMP_CLOUDPLATFORMVALUES_AWS_EKS = "aws_eks";
    var TMP_CLOUDPLATFORMVALUES_AWS_LAMBDA = "aws_lambda";
    var TMP_CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK = "aws_elastic_beanstalk";
    var TMP_CLOUDPLATFORMVALUES_AZURE_VM = "azure_vm";
    var TMP_CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES = "azure_container_instances";
    var TMP_CLOUDPLATFORMVALUES_AZURE_AKS = "azure_aks";
    var TMP_CLOUDPLATFORMVALUES_AZURE_FUNCTIONS = "azure_functions";
    var TMP_CLOUDPLATFORMVALUES_AZURE_APP_SERVICE = "azure_app_service";
    var TMP_CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE = "gcp_compute_engine";
    var TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_RUN = "gcp_cloud_run";
    var TMP_CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE = "gcp_kubernetes_engine";
    var TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS = "gcp_cloud_functions";
    var TMP_CLOUDPLATFORMVALUES_GCP_APP_ENGINE = "gcp_app_engine";
    exports.CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS = TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS;
    exports.CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC = TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC;
    exports.CLOUDPLATFORMVALUES_AWS_EC2 = TMP_CLOUDPLATFORMVALUES_AWS_EC2;
    exports.CLOUDPLATFORMVALUES_AWS_ECS = TMP_CLOUDPLATFORMVALUES_AWS_ECS;
    exports.CLOUDPLATFORMVALUES_AWS_EKS = TMP_CLOUDPLATFORMVALUES_AWS_EKS;
    exports.CLOUDPLATFORMVALUES_AWS_LAMBDA = TMP_CLOUDPLATFORMVALUES_AWS_LAMBDA;
    exports.CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK = TMP_CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK;
    exports.CLOUDPLATFORMVALUES_AZURE_VM = TMP_CLOUDPLATFORMVALUES_AZURE_VM;
    exports.CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES = TMP_CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES;
    exports.CLOUDPLATFORMVALUES_AZURE_AKS = TMP_CLOUDPLATFORMVALUES_AZURE_AKS;
    exports.CLOUDPLATFORMVALUES_AZURE_FUNCTIONS = TMP_CLOUDPLATFORMVALUES_AZURE_FUNCTIONS;
    exports.CLOUDPLATFORMVALUES_AZURE_APP_SERVICE = TMP_CLOUDPLATFORMVALUES_AZURE_APP_SERVICE;
    exports.CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE = TMP_CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE;
    exports.CLOUDPLATFORMVALUES_GCP_CLOUD_RUN = TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_RUN;
    exports.CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE = TMP_CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE;
    exports.CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS = TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS;
    exports.CLOUDPLATFORMVALUES_GCP_APP_ENGINE = TMP_CLOUDPLATFORMVALUES_GCP_APP_ENGINE;
    exports.CloudPlatformValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_ECS,
      TMP_CLOUDPLATFORMVALUES_ALIBABA_CLOUD_FC,
      TMP_CLOUDPLATFORMVALUES_AWS_EC2,
      TMP_CLOUDPLATFORMVALUES_AWS_ECS,
      TMP_CLOUDPLATFORMVALUES_AWS_EKS,
      TMP_CLOUDPLATFORMVALUES_AWS_LAMBDA,
      TMP_CLOUDPLATFORMVALUES_AWS_ELASTIC_BEANSTALK,
      TMP_CLOUDPLATFORMVALUES_AZURE_VM,
      TMP_CLOUDPLATFORMVALUES_AZURE_CONTAINER_INSTANCES,
      TMP_CLOUDPLATFORMVALUES_AZURE_AKS,
      TMP_CLOUDPLATFORMVALUES_AZURE_FUNCTIONS,
      TMP_CLOUDPLATFORMVALUES_AZURE_APP_SERVICE,
      TMP_CLOUDPLATFORMVALUES_GCP_COMPUTE_ENGINE,
      TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_RUN,
      TMP_CLOUDPLATFORMVALUES_GCP_KUBERNETES_ENGINE,
      TMP_CLOUDPLATFORMVALUES_GCP_CLOUD_FUNCTIONS,
      TMP_CLOUDPLATFORMVALUES_GCP_APP_ENGINE
    ]);
    var TMP_AWSECSLAUNCHTYPEVALUES_EC2 = "ec2";
    var TMP_AWSECSLAUNCHTYPEVALUES_FARGATE = "fargate";
    exports.AWSECSLAUNCHTYPEVALUES_EC2 = TMP_AWSECSLAUNCHTYPEVALUES_EC2;
    exports.AWSECSLAUNCHTYPEVALUES_FARGATE = TMP_AWSECSLAUNCHTYPEVALUES_FARGATE;
    exports.AwsEcsLaunchtypeValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_AWSECSLAUNCHTYPEVALUES_EC2,
      TMP_AWSECSLAUNCHTYPEVALUES_FARGATE
    ]);
    var TMP_HOSTARCHVALUES_AMD64 = "amd64";
    var TMP_HOSTARCHVALUES_ARM32 = "arm32";
    var TMP_HOSTARCHVALUES_ARM64 = "arm64";
    var TMP_HOSTARCHVALUES_IA64 = "ia64";
    var TMP_HOSTARCHVALUES_PPC32 = "ppc32";
    var TMP_HOSTARCHVALUES_PPC64 = "ppc64";
    var TMP_HOSTARCHVALUES_X86 = "x86";
    exports.HOSTARCHVALUES_AMD64 = TMP_HOSTARCHVALUES_AMD64;
    exports.HOSTARCHVALUES_ARM32 = TMP_HOSTARCHVALUES_ARM32;
    exports.HOSTARCHVALUES_ARM64 = TMP_HOSTARCHVALUES_ARM64;
    exports.HOSTARCHVALUES_IA64 = TMP_HOSTARCHVALUES_IA64;
    exports.HOSTARCHVALUES_PPC32 = TMP_HOSTARCHVALUES_PPC32;
    exports.HOSTARCHVALUES_PPC64 = TMP_HOSTARCHVALUES_PPC64;
    exports.HOSTARCHVALUES_X86 = TMP_HOSTARCHVALUES_X86;
    exports.HostArchValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_HOSTARCHVALUES_AMD64,
      TMP_HOSTARCHVALUES_ARM32,
      TMP_HOSTARCHVALUES_ARM64,
      TMP_HOSTARCHVALUES_IA64,
      TMP_HOSTARCHVALUES_PPC32,
      TMP_HOSTARCHVALUES_PPC64,
      TMP_HOSTARCHVALUES_X86
    ]);
    var TMP_OSTYPEVALUES_WINDOWS = "windows";
    var TMP_OSTYPEVALUES_LINUX = "linux";
    var TMP_OSTYPEVALUES_DARWIN = "darwin";
    var TMP_OSTYPEVALUES_FREEBSD = "freebsd";
    var TMP_OSTYPEVALUES_NETBSD = "netbsd";
    var TMP_OSTYPEVALUES_OPENBSD = "openbsd";
    var TMP_OSTYPEVALUES_DRAGONFLYBSD = "dragonflybsd";
    var TMP_OSTYPEVALUES_HPUX = "hpux";
    var TMP_OSTYPEVALUES_AIX = "aix";
    var TMP_OSTYPEVALUES_SOLARIS = "solaris";
    var TMP_OSTYPEVALUES_Z_OS = "z_os";
    exports.OSTYPEVALUES_WINDOWS = TMP_OSTYPEVALUES_WINDOWS;
    exports.OSTYPEVALUES_LINUX = TMP_OSTYPEVALUES_LINUX;
    exports.OSTYPEVALUES_DARWIN = TMP_OSTYPEVALUES_DARWIN;
    exports.OSTYPEVALUES_FREEBSD = TMP_OSTYPEVALUES_FREEBSD;
    exports.OSTYPEVALUES_NETBSD = TMP_OSTYPEVALUES_NETBSD;
    exports.OSTYPEVALUES_OPENBSD = TMP_OSTYPEVALUES_OPENBSD;
    exports.OSTYPEVALUES_DRAGONFLYBSD = TMP_OSTYPEVALUES_DRAGONFLYBSD;
    exports.OSTYPEVALUES_HPUX = TMP_OSTYPEVALUES_HPUX;
    exports.OSTYPEVALUES_AIX = TMP_OSTYPEVALUES_AIX;
    exports.OSTYPEVALUES_SOLARIS = TMP_OSTYPEVALUES_SOLARIS;
    exports.OSTYPEVALUES_Z_OS = TMP_OSTYPEVALUES_Z_OS;
    exports.OsTypeValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_OSTYPEVALUES_WINDOWS,
      TMP_OSTYPEVALUES_LINUX,
      TMP_OSTYPEVALUES_DARWIN,
      TMP_OSTYPEVALUES_FREEBSD,
      TMP_OSTYPEVALUES_NETBSD,
      TMP_OSTYPEVALUES_OPENBSD,
      TMP_OSTYPEVALUES_DRAGONFLYBSD,
      TMP_OSTYPEVALUES_HPUX,
      TMP_OSTYPEVALUES_AIX,
      TMP_OSTYPEVALUES_SOLARIS,
      TMP_OSTYPEVALUES_Z_OS
    ]);
    var TMP_TELEMETRYSDKLANGUAGEVALUES_CPP = "cpp";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_DOTNET = "dotnet";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_ERLANG = "erlang";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_GO = "go";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_JAVA = "java";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_NODEJS = "nodejs";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_PHP = "php";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_PYTHON = "python";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_RUBY = "ruby";
    var TMP_TELEMETRYSDKLANGUAGEVALUES_WEBJS = "webjs";
    exports.TELEMETRYSDKLANGUAGEVALUES_CPP = TMP_TELEMETRYSDKLANGUAGEVALUES_CPP;
    exports.TELEMETRYSDKLANGUAGEVALUES_DOTNET = TMP_TELEMETRYSDKLANGUAGEVALUES_DOTNET;
    exports.TELEMETRYSDKLANGUAGEVALUES_ERLANG = TMP_TELEMETRYSDKLANGUAGEVALUES_ERLANG;
    exports.TELEMETRYSDKLANGUAGEVALUES_GO = TMP_TELEMETRYSDKLANGUAGEVALUES_GO;
    exports.TELEMETRYSDKLANGUAGEVALUES_JAVA = TMP_TELEMETRYSDKLANGUAGEVALUES_JAVA;
    exports.TELEMETRYSDKLANGUAGEVALUES_NODEJS = TMP_TELEMETRYSDKLANGUAGEVALUES_NODEJS;
    exports.TELEMETRYSDKLANGUAGEVALUES_PHP = TMP_TELEMETRYSDKLANGUAGEVALUES_PHP;
    exports.TELEMETRYSDKLANGUAGEVALUES_PYTHON = TMP_TELEMETRYSDKLANGUAGEVALUES_PYTHON;
    exports.TELEMETRYSDKLANGUAGEVALUES_RUBY = TMP_TELEMETRYSDKLANGUAGEVALUES_RUBY;
    exports.TELEMETRYSDKLANGUAGEVALUES_WEBJS = TMP_TELEMETRYSDKLANGUAGEVALUES_WEBJS;
    exports.TelemetrySdkLanguageValues = /* @__PURE__ */ (0, utils_1.createConstMap)([
      TMP_TELEMETRYSDKLANGUAGEVALUES_CPP,
      TMP_TELEMETRYSDKLANGUAGEVALUES_DOTNET,
      TMP_TELEMETRYSDKLANGUAGEVALUES_ERLANG,
      TMP_TELEMETRYSDKLANGUAGEVALUES_GO,
      TMP_TELEMETRYSDKLANGUAGEVALUES_JAVA,
      TMP_TELEMETRYSDKLANGUAGEVALUES_NODEJS,
      TMP_TELEMETRYSDKLANGUAGEVALUES_PHP,
      TMP_TELEMETRYSDKLANGUAGEVALUES_PYTHON,
      TMP_TELEMETRYSDKLANGUAGEVALUES_RUBY,
      TMP_TELEMETRYSDKLANGUAGEVALUES_WEBJS
    ]);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/resource/index.js
var require_resource = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/resource/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: /* @__PURE__ */ __name(function() {
          return m[k];
        }, "get") };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_SemanticResourceAttributes(), exports);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_attributes.js
var require_stable_attributes = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_attributes.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ATTR_EXCEPTION_TYPE = exports.ATTR_EXCEPTION_STACKTRACE = exports.ATTR_EXCEPTION_MESSAGE = exports.ATTR_EXCEPTION_ESCAPED = exports.ERROR_TYPE_VALUE_OTHER = exports.ATTR_ERROR_TYPE = exports.DOTNET_GC_HEAP_GENERATION_VALUE_POH = exports.DOTNET_GC_HEAP_GENERATION_VALUE_LOH = exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN2 = exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN1 = exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN0 = exports.ATTR_DOTNET_GC_HEAP_GENERATION = exports.DB_SYSTEM_NAME_VALUE_POSTGRESQL = exports.DB_SYSTEM_NAME_VALUE_MYSQL = exports.DB_SYSTEM_NAME_VALUE_MICROSOFT_SQL_SERVER = exports.DB_SYSTEM_NAME_VALUE_MARIADB = exports.ATTR_DB_SYSTEM_NAME = exports.ATTR_DB_STORED_PROCEDURE_NAME = exports.ATTR_DB_RESPONSE_STATUS_CODE = exports.ATTR_DB_QUERY_TEXT = exports.ATTR_DB_QUERY_SUMMARY = exports.ATTR_DB_OPERATION_NAME = exports.ATTR_DB_OPERATION_BATCH_SIZE = exports.ATTR_DB_NAMESPACE = exports.ATTR_DB_COLLECTION_NAME = exports.ATTR_CODE_STACKTRACE = exports.ATTR_CODE_LINE_NUMBER = exports.ATTR_CODE_FUNCTION_NAME = exports.ATTR_CODE_FILE_PATH = exports.ATTR_CODE_COLUMN_NUMBER = exports.ATTR_CLIENT_PORT = exports.ATTR_CLIENT_ADDRESS = exports.ATTR_ASPNETCORE_USER_IS_AUTHENTICATED = exports.ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_SUCCESS = exports.ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_FAILURE = exports.ATTR_ASPNETCORE_ROUTING_MATCH_STATUS = exports.ATTR_ASPNETCORE_ROUTING_IS_FALLBACK = exports.ATTR_ASPNETCORE_REQUEST_IS_UNHANDLED = exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_REQUEST_CANCELED = exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_GLOBAL_LIMITER = exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ENDPOINT_LIMITER = exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ACQUIRED = exports.ATTR_ASPNETCORE_RATE_LIMITING_RESULT = exports.ATTR_ASPNETCORE_RATE_LIMITING_POLICY = exports.ATTR_ASPNETCORE_DIAGNOSTICS_HANDLER_TYPE = exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_UNHANDLED = exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_SKIPPED = exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_HANDLED = exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_ABORTED = exports.ATTR_ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT = void 0;
    exports.OTEL_STATUS_CODE_VALUE_ERROR = exports.ATTR_OTEL_STATUS_CODE = exports.ATTR_OTEL_SCOPE_VERSION = exports.ATTR_OTEL_SCOPE_NAME = exports.NETWORK_TYPE_VALUE_IPV6 = exports.NETWORK_TYPE_VALUE_IPV4 = exports.ATTR_NETWORK_TYPE = exports.NETWORK_TRANSPORT_VALUE_UNIX = exports.NETWORK_TRANSPORT_VALUE_UDP = exports.NETWORK_TRANSPORT_VALUE_TCP = exports.NETWORK_TRANSPORT_VALUE_QUIC = exports.NETWORK_TRANSPORT_VALUE_PIPE = exports.ATTR_NETWORK_TRANSPORT = exports.ATTR_NETWORK_PROTOCOL_VERSION = exports.ATTR_NETWORK_PROTOCOL_NAME = exports.ATTR_NETWORK_PEER_PORT = exports.ATTR_NETWORK_PEER_ADDRESS = exports.ATTR_NETWORK_LOCAL_PORT = exports.ATTR_NETWORK_LOCAL_ADDRESS = exports.JVM_THREAD_STATE_VALUE_WAITING = exports.JVM_THREAD_STATE_VALUE_TIMED_WAITING = exports.JVM_THREAD_STATE_VALUE_TERMINATED = exports.JVM_THREAD_STATE_VALUE_RUNNABLE = exports.JVM_THREAD_STATE_VALUE_NEW = exports.JVM_THREAD_STATE_VALUE_BLOCKED = exports.ATTR_JVM_THREAD_STATE = exports.ATTR_JVM_THREAD_DAEMON = exports.JVM_MEMORY_TYPE_VALUE_NON_HEAP = exports.JVM_MEMORY_TYPE_VALUE_HEAP = exports.ATTR_JVM_MEMORY_TYPE = exports.ATTR_JVM_MEMORY_POOL_NAME = exports.ATTR_JVM_GC_NAME = exports.ATTR_JVM_GC_ACTION = exports.ATTR_HTTP_ROUTE = exports.ATTR_HTTP_RESPONSE_STATUS_CODE = exports.ATTR_HTTP_RESPONSE_HEADER = exports.ATTR_HTTP_REQUEST_RESEND_COUNT = exports.ATTR_HTTP_REQUEST_METHOD_ORIGINAL = exports.HTTP_REQUEST_METHOD_VALUE_TRACE = exports.HTTP_REQUEST_METHOD_VALUE_PUT = exports.HTTP_REQUEST_METHOD_VALUE_POST = exports.HTTP_REQUEST_METHOD_VALUE_PATCH = exports.HTTP_REQUEST_METHOD_VALUE_OPTIONS = exports.HTTP_REQUEST_METHOD_VALUE_HEAD = exports.HTTP_REQUEST_METHOD_VALUE_GET = exports.HTTP_REQUEST_METHOD_VALUE_DELETE = exports.HTTP_REQUEST_METHOD_VALUE_CONNECT = exports.HTTP_REQUEST_METHOD_VALUE_OTHER = exports.ATTR_HTTP_REQUEST_METHOD = exports.ATTR_HTTP_REQUEST_HEADER = void 0;
    exports.ATTR_USER_AGENT_ORIGINAL = exports.ATTR_URL_SCHEME = exports.ATTR_URL_QUERY = exports.ATTR_URL_PATH = exports.ATTR_URL_FULL = exports.ATTR_URL_FRAGMENT = exports.ATTR_TELEMETRY_SDK_VERSION = exports.ATTR_TELEMETRY_SDK_NAME = exports.TELEMETRY_SDK_LANGUAGE_VALUE_WEBJS = exports.TELEMETRY_SDK_LANGUAGE_VALUE_SWIFT = exports.TELEMETRY_SDK_LANGUAGE_VALUE_RUST = exports.TELEMETRY_SDK_LANGUAGE_VALUE_RUBY = exports.TELEMETRY_SDK_LANGUAGE_VALUE_PYTHON = exports.TELEMETRY_SDK_LANGUAGE_VALUE_PHP = exports.TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS = exports.TELEMETRY_SDK_LANGUAGE_VALUE_JAVA = exports.TELEMETRY_SDK_LANGUAGE_VALUE_GO = exports.TELEMETRY_SDK_LANGUAGE_VALUE_ERLANG = exports.TELEMETRY_SDK_LANGUAGE_VALUE_DOTNET = exports.TELEMETRY_SDK_LANGUAGE_VALUE_CPP = exports.ATTR_TELEMETRY_SDK_LANGUAGE = exports.SIGNALR_TRANSPORT_VALUE_WEB_SOCKETS = exports.SIGNALR_TRANSPORT_VALUE_SERVER_SENT_EVENTS = exports.SIGNALR_TRANSPORT_VALUE_LONG_POLLING = exports.ATTR_SIGNALR_TRANSPORT = exports.SIGNALR_CONNECTION_STATUS_VALUE_TIMEOUT = exports.SIGNALR_CONNECTION_STATUS_VALUE_NORMAL_CLOSURE = exports.SIGNALR_CONNECTION_STATUS_VALUE_APP_SHUTDOWN = exports.ATTR_SIGNALR_CONNECTION_STATUS = exports.ATTR_SERVICE_VERSION = exports.ATTR_SERVICE_NAME = exports.ATTR_SERVER_PORT = exports.ATTR_SERVER_ADDRESS = exports.ATTR_OTEL_STATUS_DESCRIPTION = exports.OTEL_STATUS_CODE_VALUE_OK = void 0;
    exports.ATTR_ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT = "aspnetcore.diagnostics.exception.result";
    exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_ABORTED = "aborted";
    exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_HANDLED = "handled";
    exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_SKIPPED = "skipped";
    exports.ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT_VALUE_UNHANDLED = "unhandled";
    exports.ATTR_ASPNETCORE_DIAGNOSTICS_HANDLER_TYPE = "aspnetcore.diagnostics.handler.type";
    exports.ATTR_ASPNETCORE_RATE_LIMITING_POLICY = "aspnetcore.rate_limiting.policy";
    exports.ATTR_ASPNETCORE_RATE_LIMITING_RESULT = "aspnetcore.rate_limiting.result";
    exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ACQUIRED = "acquired";
    exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_ENDPOINT_LIMITER = "endpoint_limiter";
    exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_GLOBAL_LIMITER = "global_limiter";
    exports.ASPNETCORE_RATE_LIMITING_RESULT_VALUE_REQUEST_CANCELED = "request_canceled";
    exports.ATTR_ASPNETCORE_REQUEST_IS_UNHANDLED = "aspnetcore.request.is_unhandled";
    exports.ATTR_ASPNETCORE_ROUTING_IS_FALLBACK = "aspnetcore.routing.is_fallback";
    exports.ATTR_ASPNETCORE_ROUTING_MATCH_STATUS = "aspnetcore.routing.match_status";
    exports.ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_FAILURE = "failure";
    exports.ASPNETCORE_ROUTING_MATCH_STATUS_VALUE_SUCCESS = "success";
    exports.ATTR_ASPNETCORE_USER_IS_AUTHENTICATED = "aspnetcore.user.is_authenticated";
    exports.ATTR_CLIENT_ADDRESS = "client.address";
    exports.ATTR_CLIENT_PORT = "client.port";
    exports.ATTR_CODE_COLUMN_NUMBER = "code.column.number";
    exports.ATTR_CODE_FILE_PATH = "code.file.path";
    exports.ATTR_CODE_FUNCTION_NAME = "code.function.name";
    exports.ATTR_CODE_LINE_NUMBER = "code.line.number";
    exports.ATTR_CODE_STACKTRACE = "code.stacktrace";
    exports.ATTR_DB_COLLECTION_NAME = "db.collection.name";
    exports.ATTR_DB_NAMESPACE = "db.namespace";
    exports.ATTR_DB_OPERATION_BATCH_SIZE = "db.operation.batch.size";
    exports.ATTR_DB_OPERATION_NAME = "db.operation.name";
    exports.ATTR_DB_QUERY_SUMMARY = "db.query.summary";
    exports.ATTR_DB_QUERY_TEXT = "db.query.text";
    exports.ATTR_DB_RESPONSE_STATUS_CODE = "db.response.status_code";
    exports.ATTR_DB_STORED_PROCEDURE_NAME = "db.stored_procedure.name";
    exports.ATTR_DB_SYSTEM_NAME = "db.system.name";
    exports.DB_SYSTEM_NAME_VALUE_MARIADB = "mariadb";
    exports.DB_SYSTEM_NAME_VALUE_MICROSOFT_SQL_SERVER = "microsoft.sql_server";
    exports.DB_SYSTEM_NAME_VALUE_MYSQL = "mysql";
    exports.DB_SYSTEM_NAME_VALUE_POSTGRESQL = "postgresql";
    exports.ATTR_DOTNET_GC_HEAP_GENERATION = "dotnet.gc.heap.generation";
    exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN0 = "gen0";
    exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN1 = "gen1";
    exports.DOTNET_GC_HEAP_GENERATION_VALUE_GEN2 = "gen2";
    exports.DOTNET_GC_HEAP_GENERATION_VALUE_LOH = "loh";
    exports.DOTNET_GC_HEAP_GENERATION_VALUE_POH = "poh";
    exports.ATTR_ERROR_TYPE = "error.type";
    exports.ERROR_TYPE_VALUE_OTHER = "_OTHER";
    exports.ATTR_EXCEPTION_ESCAPED = "exception.escaped";
    exports.ATTR_EXCEPTION_MESSAGE = "exception.message";
    exports.ATTR_EXCEPTION_STACKTRACE = "exception.stacktrace";
    exports.ATTR_EXCEPTION_TYPE = "exception.type";
    var ATTR_HTTP_REQUEST_HEADER = /* @__PURE__ */ __name((key) => `http.request.header.${key}`, "ATTR_HTTP_REQUEST_HEADER");
    exports.ATTR_HTTP_REQUEST_HEADER = ATTR_HTTP_REQUEST_HEADER;
    exports.ATTR_HTTP_REQUEST_METHOD = "http.request.method";
    exports.HTTP_REQUEST_METHOD_VALUE_OTHER = "_OTHER";
    exports.HTTP_REQUEST_METHOD_VALUE_CONNECT = "CONNECT";
    exports.HTTP_REQUEST_METHOD_VALUE_DELETE = "DELETE";
    exports.HTTP_REQUEST_METHOD_VALUE_GET = "GET";
    exports.HTTP_REQUEST_METHOD_VALUE_HEAD = "HEAD";
    exports.HTTP_REQUEST_METHOD_VALUE_OPTIONS = "OPTIONS";
    exports.HTTP_REQUEST_METHOD_VALUE_PATCH = "PATCH";
    exports.HTTP_REQUEST_METHOD_VALUE_POST = "POST";
    exports.HTTP_REQUEST_METHOD_VALUE_PUT = "PUT";
    exports.HTTP_REQUEST_METHOD_VALUE_TRACE = "TRACE";
    exports.ATTR_HTTP_REQUEST_METHOD_ORIGINAL = "http.request.method_original";
    exports.ATTR_HTTP_REQUEST_RESEND_COUNT = "http.request.resend_count";
    var ATTR_HTTP_RESPONSE_HEADER = /* @__PURE__ */ __name((key) => `http.response.header.${key}`, "ATTR_HTTP_RESPONSE_HEADER");
    exports.ATTR_HTTP_RESPONSE_HEADER = ATTR_HTTP_RESPONSE_HEADER;
    exports.ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code";
    exports.ATTR_HTTP_ROUTE = "http.route";
    exports.ATTR_JVM_GC_ACTION = "jvm.gc.action";
    exports.ATTR_JVM_GC_NAME = "jvm.gc.name";
    exports.ATTR_JVM_MEMORY_POOL_NAME = "jvm.memory.pool.name";
    exports.ATTR_JVM_MEMORY_TYPE = "jvm.memory.type";
    exports.JVM_MEMORY_TYPE_VALUE_HEAP = "heap";
    exports.JVM_MEMORY_TYPE_VALUE_NON_HEAP = "non_heap";
    exports.ATTR_JVM_THREAD_DAEMON = "jvm.thread.daemon";
    exports.ATTR_JVM_THREAD_STATE = "jvm.thread.state";
    exports.JVM_THREAD_STATE_VALUE_BLOCKED = "blocked";
    exports.JVM_THREAD_STATE_VALUE_NEW = "new";
    exports.JVM_THREAD_STATE_VALUE_RUNNABLE = "runnable";
    exports.JVM_THREAD_STATE_VALUE_TERMINATED = "terminated";
    exports.JVM_THREAD_STATE_VALUE_TIMED_WAITING = "timed_waiting";
    exports.JVM_THREAD_STATE_VALUE_WAITING = "waiting";
    exports.ATTR_NETWORK_LOCAL_ADDRESS = "network.local.address";
    exports.ATTR_NETWORK_LOCAL_PORT = "network.local.port";
    exports.ATTR_NETWORK_PEER_ADDRESS = "network.peer.address";
    exports.ATTR_NETWORK_PEER_PORT = "network.peer.port";
    exports.ATTR_NETWORK_PROTOCOL_NAME = "network.protocol.name";
    exports.ATTR_NETWORK_PROTOCOL_VERSION = "network.protocol.version";
    exports.ATTR_NETWORK_TRANSPORT = "network.transport";
    exports.NETWORK_TRANSPORT_VALUE_PIPE = "pipe";
    exports.NETWORK_TRANSPORT_VALUE_QUIC = "quic";
    exports.NETWORK_TRANSPORT_VALUE_TCP = "tcp";
    exports.NETWORK_TRANSPORT_VALUE_UDP = "udp";
    exports.NETWORK_TRANSPORT_VALUE_UNIX = "unix";
    exports.ATTR_NETWORK_TYPE = "network.type";
    exports.NETWORK_TYPE_VALUE_IPV4 = "ipv4";
    exports.NETWORK_TYPE_VALUE_IPV6 = "ipv6";
    exports.ATTR_OTEL_SCOPE_NAME = "otel.scope.name";
    exports.ATTR_OTEL_SCOPE_VERSION = "otel.scope.version";
    exports.ATTR_OTEL_STATUS_CODE = "otel.status_code";
    exports.OTEL_STATUS_CODE_VALUE_ERROR = "ERROR";
    exports.OTEL_STATUS_CODE_VALUE_OK = "OK";
    exports.ATTR_OTEL_STATUS_DESCRIPTION = "otel.status_description";
    exports.ATTR_SERVER_ADDRESS = "server.address";
    exports.ATTR_SERVER_PORT = "server.port";
    exports.ATTR_SERVICE_NAME = "service.name";
    exports.ATTR_SERVICE_VERSION = "service.version";
    exports.ATTR_SIGNALR_CONNECTION_STATUS = "signalr.connection.status";
    exports.SIGNALR_CONNECTION_STATUS_VALUE_APP_SHUTDOWN = "app_shutdown";
    exports.SIGNALR_CONNECTION_STATUS_VALUE_NORMAL_CLOSURE = "normal_closure";
    exports.SIGNALR_CONNECTION_STATUS_VALUE_TIMEOUT = "timeout";
    exports.ATTR_SIGNALR_TRANSPORT = "signalr.transport";
    exports.SIGNALR_TRANSPORT_VALUE_LONG_POLLING = "long_polling";
    exports.SIGNALR_TRANSPORT_VALUE_SERVER_SENT_EVENTS = "server_sent_events";
    exports.SIGNALR_TRANSPORT_VALUE_WEB_SOCKETS = "web_sockets";
    exports.ATTR_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_CPP = "cpp";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_DOTNET = "dotnet";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_ERLANG = "erlang";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_GO = "go";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_JAVA = "java";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS = "nodejs";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_PHP = "php";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_PYTHON = "python";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_RUBY = "ruby";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_RUST = "rust";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_SWIFT = "swift";
    exports.TELEMETRY_SDK_LANGUAGE_VALUE_WEBJS = "webjs";
    exports.ATTR_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
    exports.ATTR_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
    exports.ATTR_URL_FRAGMENT = "url.fragment";
    exports.ATTR_URL_FULL = "url.full";
    exports.ATTR_URL_PATH = "url.path";
    exports.ATTR_URL_QUERY = "url.query";
    exports.ATTR_URL_SCHEME = "url.scheme";
    exports.ATTR_USER_AGENT_ORIGINAL = "user_agent.original";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_metrics.js
var require_stable_metrics = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_metrics.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.METRIC_SIGNALR_SERVER_ACTIVE_CONNECTIONS = exports.METRIC_KESTREL_UPGRADED_CONNECTIONS = exports.METRIC_KESTREL_TLS_HANDSHAKE_DURATION = exports.METRIC_KESTREL_REJECTED_CONNECTIONS = exports.METRIC_KESTREL_QUEUED_REQUESTS = exports.METRIC_KESTREL_QUEUED_CONNECTIONS = exports.METRIC_KESTREL_CONNECTION_DURATION = exports.METRIC_KESTREL_ACTIVE_TLS_HANDSHAKES = exports.METRIC_KESTREL_ACTIVE_CONNECTIONS = exports.METRIC_JVM_THREAD_COUNT = exports.METRIC_JVM_MEMORY_USED_AFTER_LAST_GC = exports.METRIC_JVM_MEMORY_USED = exports.METRIC_JVM_MEMORY_LIMIT = exports.METRIC_JVM_MEMORY_COMMITTED = exports.METRIC_JVM_GC_DURATION = exports.METRIC_JVM_CPU_TIME = exports.METRIC_JVM_CPU_RECENT_UTILIZATION = exports.METRIC_JVM_CPU_COUNT = exports.METRIC_JVM_CLASS_UNLOADED = exports.METRIC_JVM_CLASS_LOADED = exports.METRIC_JVM_CLASS_COUNT = exports.METRIC_HTTP_SERVER_REQUEST_DURATION = exports.METRIC_HTTP_CLIENT_REQUEST_DURATION = exports.METRIC_DOTNET_TIMER_COUNT = exports.METRIC_DOTNET_THREAD_POOL_WORK_ITEM_COUNT = exports.METRIC_DOTNET_THREAD_POOL_THREAD_COUNT = exports.METRIC_DOTNET_THREAD_POOL_QUEUE_LENGTH = exports.METRIC_DOTNET_PROCESS_MEMORY_WORKING_SET = exports.METRIC_DOTNET_PROCESS_CPU_TIME = exports.METRIC_DOTNET_PROCESS_CPU_COUNT = exports.METRIC_DOTNET_MONITOR_LOCK_CONTENTIONS = exports.METRIC_DOTNET_JIT_COMPILED_METHODS = exports.METRIC_DOTNET_JIT_COMPILED_IL_SIZE = exports.METRIC_DOTNET_JIT_COMPILATION_TIME = exports.METRIC_DOTNET_GC_PAUSE_TIME = exports.METRIC_DOTNET_GC_LAST_COLLECTION_MEMORY_COMMITTED_SIZE = exports.METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_SIZE = exports.METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_FRAGMENTATION_SIZE = exports.METRIC_DOTNET_GC_HEAP_TOTAL_ALLOCATED = exports.METRIC_DOTNET_GC_COLLECTIONS = exports.METRIC_DOTNET_EXCEPTIONS = exports.METRIC_DOTNET_ASSEMBLY_COUNT = exports.METRIC_DB_CLIENT_OPERATION_DURATION = exports.METRIC_ASPNETCORE_ROUTING_MATCH_ATTEMPTS = exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUESTS = exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_LEASE_DURATION = exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_TIME_IN_QUEUE = exports.METRIC_ASPNETCORE_RATE_LIMITING_QUEUED_REQUESTS = exports.METRIC_ASPNETCORE_RATE_LIMITING_ACTIVE_REQUEST_LEASES = exports.METRIC_ASPNETCORE_DIAGNOSTICS_EXCEPTIONS = void 0;
    exports.METRIC_SIGNALR_SERVER_CONNECTION_DURATION = void 0;
    exports.METRIC_ASPNETCORE_DIAGNOSTICS_EXCEPTIONS = "aspnetcore.diagnostics.exceptions";
    exports.METRIC_ASPNETCORE_RATE_LIMITING_ACTIVE_REQUEST_LEASES = "aspnetcore.rate_limiting.active_request_leases";
    exports.METRIC_ASPNETCORE_RATE_LIMITING_QUEUED_REQUESTS = "aspnetcore.rate_limiting.queued_requests";
    exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_TIME_IN_QUEUE = "aspnetcore.rate_limiting.request.time_in_queue";
    exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUEST_LEASE_DURATION = "aspnetcore.rate_limiting.request_lease.duration";
    exports.METRIC_ASPNETCORE_RATE_LIMITING_REQUESTS = "aspnetcore.rate_limiting.requests";
    exports.METRIC_ASPNETCORE_ROUTING_MATCH_ATTEMPTS = "aspnetcore.routing.match_attempts";
    exports.METRIC_DB_CLIENT_OPERATION_DURATION = "db.client.operation.duration";
    exports.METRIC_DOTNET_ASSEMBLY_COUNT = "dotnet.assembly.count";
    exports.METRIC_DOTNET_EXCEPTIONS = "dotnet.exceptions";
    exports.METRIC_DOTNET_GC_COLLECTIONS = "dotnet.gc.collections";
    exports.METRIC_DOTNET_GC_HEAP_TOTAL_ALLOCATED = "dotnet.gc.heap.total_allocated";
    exports.METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_FRAGMENTATION_SIZE = "dotnet.gc.last_collection.heap.fragmentation.size";
    exports.METRIC_DOTNET_GC_LAST_COLLECTION_HEAP_SIZE = "dotnet.gc.last_collection.heap.size";
    exports.METRIC_DOTNET_GC_LAST_COLLECTION_MEMORY_COMMITTED_SIZE = "dotnet.gc.last_collection.memory.committed_size";
    exports.METRIC_DOTNET_GC_PAUSE_TIME = "dotnet.gc.pause.time";
    exports.METRIC_DOTNET_JIT_COMPILATION_TIME = "dotnet.jit.compilation.time";
    exports.METRIC_DOTNET_JIT_COMPILED_IL_SIZE = "dotnet.jit.compiled_il.size";
    exports.METRIC_DOTNET_JIT_COMPILED_METHODS = "dotnet.jit.compiled_methods";
    exports.METRIC_DOTNET_MONITOR_LOCK_CONTENTIONS = "dotnet.monitor.lock_contentions";
    exports.METRIC_DOTNET_PROCESS_CPU_COUNT = "dotnet.process.cpu.count";
    exports.METRIC_DOTNET_PROCESS_CPU_TIME = "dotnet.process.cpu.time";
    exports.METRIC_DOTNET_PROCESS_MEMORY_WORKING_SET = "dotnet.process.memory.working_set";
    exports.METRIC_DOTNET_THREAD_POOL_QUEUE_LENGTH = "dotnet.thread_pool.queue.length";
    exports.METRIC_DOTNET_THREAD_POOL_THREAD_COUNT = "dotnet.thread_pool.thread.count";
    exports.METRIC_DOTNET_THREAD_POOL_WORK_ITEM_COUNT = "dotnet.thread_pool.work_item.count";
    exports.METRIC_DOTNET_TIMER_COUNT = "dotnet.timer.count";
    exports.METRIC_HTTP_CLIENT_REQUEST_DURATION = "http.client.request.duration";
    exports.METRIC_HTTP_SERVER_REQUEST_DURATION = "http.server.request.duration";
    exports.METRIC_JVM_CLASS_COUNT = "jvm.class.count";
    exports.METRIC_JVM_CLASS_LOADED = "jvm.class.loaded";
    exports.METRIC_JVM_CLASS_UNLOADED = "jvm.class.unloaded";
    exports.METRIC_JVM_CPU_COUNT = "jvm.cpu.count";
    exports.METRIC_JVM_CPU_RECENT_UTILIZATION = "jvm.cpu.recent_utilization";
    exports.METRIC_JVM_CPU_TIME = "jvm.cpu.time";
    exports.METRIC_JVM_GC_DURATION = "jvm.gc.duration";
    exports.METRIC_JVM_MEMORY_COMMITTED = "jvm.memory.committed";
    exports.METRIC_JVM_MEMORY_LIMIT = "jvm.memory.limit";
    exports.METRIC_JVM_MEMORY_USED = "jvm.memory.used";
    exports.METRIC_JVM_MEMORY_USED_AFTER_LAST_GC = "jvm.memory.used_after_last_gc";
    exports.METRIC_JVM_THREAD_COUNT = "jvm.thread.count";
    exports.METRIC_KESTREL_ACTIVE_CONNECTIONS = "kestrel.active_connections";
    exports.METRIC_KESTREL_ACTIVE_TLS_HANDSHAKES = "kestrel.active_tls_handshakes";
    exports.METRIC_KESTREL_CONNECTION_DURATION = "kestrel.connection.duration";
    exports.METRIC_KESTREL_QUEUED_CONNECTIONS = "kestrel.queued_connections";
    exports.METRIC_KESTREL_QUEUED_REQUESTS = "kestrel.queued_requests";
    exports.METRIC_KESTREL_REJECTED_CONNECTIONS = "kestrel.rejected_connections";
    exports.METRIC_KESTREL_TLS_HANDSHAKE_DURATION = "kestrel.tls_handshake.duration";
    exports.METRIC_KESTREL_UPGRADED_CONNECTIONS = "kestrel.upgraded_connections";
    exports.METRIC_SIGNALR_SERVER_ACTIVE_CONNECTIONS = "signalr.server.active_connections";
    exports.METRIC_SIGNALR_SERVER_CONNECTION_DURATION = "signalr.server.connection.duration";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_events.js
var require_stable_events = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/stable_events.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EVENT_EXCEPTION = void 0;
    exports.EVENT_EXCEPTION = "exception";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/index.js
var require_src2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+semantic-conventions@1.38.0/node_modules/@opentelemetry/semantic-conventions/build/src/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: /* @__PURE__ */ __name(function() {
          return m[k];
        }, "get") };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_trace2(), exports);
    __exportStar(require_resource(), exports);
    __exportStar(require_stable_attributes(), exports);
    __exportStar(require_stable_metrics(), exports);
    __exportStar(require_stable_events(), exports);
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/semconv.js
var require_semconv = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/semconv.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ATTR_PROCESS_RUNTIME_NAME = void 0;
    exports.ATTR_PROCESS_RUNTIME_NAME = "process.runtime.name";
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/sdk-info.js
var require_sdk_info = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/sdk-info.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SDK_INFO = void 0;
    var version_1 = require_version2();
    var semantic_conventions_1 = require_src2();
    var semconv_1 = require_semconv();
    exports.SDK_INFO = {
      [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: "opentelemetry",
      [semconv_1.ATTR_PROCESS_RUNTIME_NAME]: "browser",
      [semantic_conventions_1.ATTR_TELEMETRY_SDK_LANGUAGE]: semantic_conventions_1.TELEMETRY_SDK_LANGUAGE_VALUE_WEBJS,
      [semantic_conventions_1.ATTR_TELEMETRY_SDK_VERSION]: version_1.VERSION
    };
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/index.js
var require_browser2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/platform/browser/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SDK_INFO = exports.otperformance = exports._globalThis = exports.getStringListFromEnv = exports.getNumberFromEnv = exports.getBooleanFromEnv = exports.getStringFromEnv = void 0;
    var environment_1 = require_environment();
    Object.defineProperty(exports, "getStringFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return environment_1.getStringFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getBooleanFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return environment_1.getBooleanFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getNumberFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return environment_1.getNumberFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getStringListFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return environment_1.getStringListFromEnv;
    }, "get") });
    var globalThis_1 = require_globalThis2();
    Object.defineProperty(exports, "_globalThis", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return globalThis_1._globalThis;
    }, "get") });
    var performance_1 = require_performance();
    Object.defineProperty(exports, "otperformance", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return performance_1.otperformance;
    }, "get") });
    var sdk_info_1 = require_sdk_info();
    Object.defineProperty(exports, "SDK_INFO", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return sdk_info_1.SDK_INFO;
    }, "get") });
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/time.js
var require_time = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/time.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.addHrTimes = exports.isTimeInput = exports.isTimeInputHrTime = exports.hrTimeToMicroseconds = exports.hrTimeToMilliseconds = exports.hrTimeToNanoseconds = exports.hrTimeToTimeStamp = exports.hrTimeDuration = exports.timeInputToHrTime = exports.hrTime = exports.getTimeOrigin = exports.millisToHrTime = void 0;
    var platform_1 = require_browser2();
    var NANOSECOND_DIGITS = 9;
    var NANOSECOND_DIGITS_IN_MILLIS = 6;
    var MILLISECONDS_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS_IN_MILLIS);
    var SECOND_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS);
    function millisToHrTime(epochMillis) {
      const epochSeconds = epochMillis / 1e3;
      const seconds = Math.trunc(epochSeconds);
      const nanos = Math.round(epochMillis % 1e3 * MILLISECONDS_TO_NANOSECONDS);
      return [seconds, nanos];
    }
    __name(millisToHrTime, "millisToHrTime");
    exports.millisToHrTime = millisToHrTime;
    function getTimeOrigin() {
      let timeOrigin = platform_1.otperformance.timeOrigin;
      if (typeof timeOrigin !== "number") {
        const perf = platform_1.otperformance;
        timeOrigin = perf.timing && perf.timing.fetchStart;
      }
      return timeOrigin;
    }
    __name(getTimeOrigin, "getTimeOrigin");
    exports.getTimeOrigin = getTimeOrigin;
    function hrTime(performanceNow) {
      const timeOrigin = millisToHrTime(getTimeOrigin());
      const now = millisToHrTime(typeof performanceNow === "number" ? performanceNow : platform_1.otperformance.now());
      return addHrTimes(timeOrigin, now);
    }
    __name(hrTime, "hrTime");
    exports.hrTime = hrTime;
    function timeInputToHrTime(time3) {
      if (isTimeInputHrTime(time3)) {
        return time3;
      } else if (typeof time3 === "number") {
        if (time3 < getTimeOrigin()) {
          return hrTime(time3);
        } else {
          return millisToHrTime(time3);
        }
      } else if (time3 instanceof Date) {
        return millisToHrTime(time3.getTime());
      } else {
        throw TypeError("Invalid input type");
      }
    }
    __name(timeInputToHrTime, "timeInputToHrTime");
    exports.timeInputToHrTime = timeInputToHrTime;
    function hrTimeDuration(startTime, endTime) {
      let seconds = endTime[0] - startTime[0];
      let nanos = endTime[1] - startTime[1];
      if (nanos < 0) {
        seconds -= 1;
        nanos += SECOND_TO_NANOSECONDS;
      }
      return [seconds, nanos];
    }
    __name(hrTimeDuration, "hrTimeDuration");
    exports.hrTimeDuration = hrTimeDuration;
    function hrTimeToTimeStamp(time3) {
      const precision = NANOSECOND_DIGITS;
      const tmp = `${"0".repeat(precision)}${time3[1]}Z`;
      const nanoString = tmp.substring(tmp.length - precision - 1);
      const date = new Date(time3[0] * 1e3).toISOString();
      return date.replace("000Z", nanoString);
    }
    __name(hrTimeToTimeStamp, "hrTimeToTimeStamp");
    exports.hrTimeToTimeStamp = hrTimeToTimeStamp;
    function hrTimeToNanoseconds2(time3) {
      return time3[0] * SECOND_TO_NANOSECONDS + time3[1];
    }
    __name(hrTimeToNanoseconds2, "hrTimeToNanoseconds");
    exports.hrTimeToNanoseconds = hrTimeToNanoseconds2;
    function hrTimeToMilliseconds(time3) {
      return time3[0] * 1e3 + time3[1] / 1e6;
    }
    __name(hrTimeToMilliseconds, "hrTimeToMilliseconds");
    exports.hrTimeToMilliseconds = hrTimeToMilliseconds;
    function hrTimeToMicroseconds(time3) {
      return time3[0] * 1e6 + time3[1] / 1e3;
    }
    __name(hrTimeToMicroseconds, "hrTimeToMicroseconds");
    exports.hrTimeToMicroseconds = hrTimeToMicroseconds;
    function isTimeInputHrTime(value) {
      return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number";
    }
    __name(isTimeInputHrTime, "isTimeInputHrTime");
    exports.isTimeInputHrTime = isTimeInputHrTime;
    function isTimeInput(value) {
      return isTimeInputHrTime(value) || typeof value === "number" || value instanceof Date;
    }
    __name(isTimeInput, "isTimeInput");
    exports.isTimeInput = isTimeInput;
    function addHrTimes(time1, time22) {
      const out = [time1[0] + time22[0], time1[1] + time22[1]];
      if (out[1] >= SECOND_TO_NANOSECONDS) {
        out[1] -= SECOND_TO_NANOSECONDS;
        out[0] += 1;
      }
      return out;
    }
    __name(addHrTimes, "addHrTimes");
    exports.addHrTimes = addHrTimes;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/timer-util.js
var require_timer_util = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/common/timer-util.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unrefTimer = void 0;
    function unrefTimer(timer) {
      if (typeof timer !== "number") {
        timer.unref();
      }
    }
    __name(unrefTimer, "unrefTimer");
    exports.unrefTimer = unrefTimer;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/ExportResult.js
var require_ExportResult = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/ExportResult.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExportResultCode = void 0;
    var ExportResultCode2;
    (function(ExportResultCode3) {
      ExportResultCode3[ExportResultCode3["SUCCESS"] = 0] = "SUCCESS";
      ExportResultCode3[ExportResultCode3["FAILED"] = 1] = "FAILED";
    })(ExportResultCode2 = exports.ExportResultCode || (exports.ExportResultCode = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/propagation/composite.js
var require_composite = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/propagation/composite.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CompositePropagator = void 0;
    var api_1 = require_src();
    var CompositePropagator = class {
      static {
        __name(this, "CompositePropagator");
      }
      _propagators;
      _fields;
      /**
       * Construct a composite propagator from a list of propagators.
       *
       * @param [config] Configuration object for composite propagator
       */
      constructor(config2 = {}) {
        this._propagators = config2.propagators ?? [];
        this._fields = Array.from(new Set(this._propagators.map((p) => typeof p.fields === "function" ? p.fields() : []).reduce((x, y) => x.concat(y), [])));
      }
      /**
       * Run each of the configured propagators with the given context and carrier.
       * Propagators are run in the order they are configured, so if multiple
       * propagators write the same carrier key, the propagator later in the list
       * will "win".
       *
       * @param context Context to inject
       * @param carrier Carrier into which context will be injected
       */
      inject(context4, carrier, setter) {
        for (const propagator of this._propagators) {
          try {
            propagator.inject(context4, carrier, setter);
          } catch (err) {
            api_1.diag.warn(`Failed to inject with ${propagator.constructor.name}. Err: ${err.message}`);
          }
        }
      }
      /**
       * Run each of the configured propagators with the given context and carrier.
       * Propagators are run in the order they are configured, so if multiple
       * propagators write the same context key, the propagator later in the list
       * will "win".
       *
       * @param context Context to add values to
       * @param carrier Carrier from which to extract context
       */
      extract(context4, carrier, getter) {
        return this._propagators.reduce((ctx, propagator) => {
          try {
            return propagator.extract(ctx, carrier, getter);
          } catch (err) {
            api_1.diag.warn(`Failed to extract with ${propagator.constructor.name}. Err: ${err.message}`);
          }
          return ctx;
        }, context4);
      }
      fields() {
        return this._fields.slice();
      }
    };
    exports.CompositePropagator = CompositePropagator;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/internal/validators.js
var require_validators = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/internal/validators.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateValue = exports.validateKey = void 0;
    var VALID_KEY_CHAR_RANGE = "[_0-9a-z-*/]";
    var VALID_KEY = `[a-z]${VALID_KEY_CHAR_RANGE}{0,255}`;
    var VALID_VENDOR_KEY = `[a-z0-9]${VALID_KEY_CHAR_RANGE}{0,240}@[a-z]${VALID_KEY_CHAR_RANGE}{0,13}`;
    var VALID_KEY_REGEX = new RegExp(`^(?:${VALID_KEY}|${VALID_VENDOR_KEY})$`);
    var VALID_VALUE_BASE_REGEX = /^[ -~]{0,255}[!-~]$/;
    var INVALID_VALUE_COMMA_EQUAL_REGEX = /,|=/;
    function validateKey(key) {
      return VALID_KEY_REGEX.test(key);
    }
    __name(validateKey, "validateKey");
    exports.validateKey = validateKey;
    function validateValue(value) {
      return VALID_VALUE_BASE_REGEX.test(value) && !INVALID_VALUE_COMMA_EQUAL_REGEX.test(value);
    }
    __name(validateValue, "validateValue");
    exports.validateValue = validateValue;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/TraceState.js
var require_TraceState = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/TraceState.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TraceState = void 0;
    var validators_1 = require_validators();
    var MAX_TRACE_STATE_ITEMS = 32;
    var MAX_TRACE_STATE_LEN = 512;
    var LIST_MEMBERS_SEPARATOR = ",";
    var LIST_MEMBER_KEY_VALUE_SPLITTER = "=";
    var TraceState = class _TraceState {
      static {
        __name(this, "TraceState");
      }
      _internalState = /* @__PURE__ */ new Map();
      constructor(rawTraceState) {
        if (rawTraceState)
          this._parse(rawTraceState);
      }
      set(key, value) {
        const traceState = this._clone();
        if (traceState._internalState.has(key)) {
          traceState._internalState.delete(key);
        }
        traceState._internalState.set(key, value);
        return traceState;
      }
      unset(key) {
        const traceState = this._clone();
        traceState._internalState.delete(key);
        return traceState;
      }
      get(key) {
        return this._internalState.get(key);
      }
      serialize() {
        return this._keys().reduce((agg, key) => {
          agg.push(key + LIST_MEMBER_KEY_VALUE_SPLITTER + this.get(key));
          return agg;
        }, []).join(LIST_MEMBERS_SEPARATOR);
      }
      _parse(rawTraceState) {
        if (rawTraceState.length > MAX_TRACE_STATE_LEN)
          return;
        this._internalState = rawTraceState.split(LIST_MEMBERS_SEPARATOR).reverse().reduce((agg, part) => {
          const listMember = part.trim();
          const i = listMember.indexOf(LIST_MEMBER_KEY_VALUE_SPLITTER);
          if (i !== -1) {
            const key = listMember.slice(0, i);
            const value = listMember.slice(i + 1, part.length);
            if ((0, validators_1.validateKey)(key) && (0, validators_1.validateValue)(value)) {
              agg.set(key, value);
            } else {
            }
          }
          return agg;
        }, /* @__PURE__ */ new Map());
        if (this._internalState.size > MAX_TRACE_STATE_ITEMS) {
          this._internalState = new Map(Array.from(this._internalState.entries()).reverse().slice(0, MAX_TRACE_STATE_ITEMS));
        }
      }
      _keys() {
        return Array.from(this._internalState.keys()).reverse();
      }
      _clone() {
        const traceState = new _TraceState();
        traceState._internalState = new Map(this._internalState);
        return traceState;
      }
    };
    exports.TraceState = TraceState;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/W3CTraceContextPropagator.js
var require_W3CTraceContextPropagator = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/W3CTraceContextPropagator.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.W3CTraceContextPropagator = exports.parseTraceParent = exports.TRACE_STATE_HEADER = exports.TRACE_PARENT_HEADER = void 0;
    var api_1 = require_src();
    var suppress_tracing_1 = require_suppress_tracing();
    var TraceState_1 = require_TraceState();
    exports.TRACE_PARENT_HEADER = "traceparent";
    exports.TRACE_STATE_HEADER = "tracestate";
    var VERSION = "00";
    var VERSION_PART = "(?!ff)[\\da-f]{2}";
    var TRACE_ID_PART = "(?![0]{32})[\\da-f]{32}";
    var PARENT_ID_PART = "(?![0]{16})[\\da-f]{16}";
    var FLAGS_PART = "[\\da-f]{2}";
    var TRACE_PARENT_REGEX = new RegExp(`^\\s?(${VERSION_PART})-(${TRACE_ID_PART})-(${PARENT_ID_PART})-(${FLAGS_PART})(-.*)?\\s?$`);
    function parseTraceParent(traceParent) {
      const match = TRACE_PARENT_REGEX.exec(traceParent);
      if (!match)
        return null;
      if (match[1] === "00" && match[5])
        return null;
      return {
        traceId: match[2],
        spanId: match[3],
        traceFlags: parseInt(match[4], 16)
      };
    }
    __name(parseTraceParent, "parseTraceParent");
    exports.parseTraceParent = parseTraceParent;
    var W3CTraceContextPropagator2 = class {
      static {
        __name(this, "W3CTraceContextPropagator");
      }
      inject(context4, carrier, setter) {
        const spanContext = api_1.trace.getSpanContext(context4);
        if (!spanContext || (0, suppress_tracing_1.isTracingSuppressed)(context4) || !(0, api_1.isSpanContextValid)(spanContext))
          return;
        const traceParent = `${VERSION}-${spanContext.traceId}-${spanContext.spanId}-0${Number(spanContext.traceFlags || api_1.TraceFlags.NONE).toString(16)}`;
        setter.set(carrier, exports.TRACE_PARENT_HEADER, traceParent);
        if (spanContext.traceState) {
          setter.set(carrier, exports.TRACE_STATE_HEADER, spanContext.traceState.serialize());
        }
      }
      extract(context4, carrier, getter) {
        const traceParentHeader = getter.get(carrier, exports.TRACE_PARENT_HEADER);
        if (!traceParentHeader)
          return context4;
        const traceParent = Array.isArray(traceParentHeader) ? traceParentHeader[0] : traceParentHeader;
        if (typeof traceParent !== "string")
          return context4;
        const spanContext = parseTraceParent(traceParent);
        if (!spanContext)
          return context4;
        spanContext.isRemote = true;
        const traceStateHeader = getter.get(carrier, exports.TRACE_STATE_HEADER);
        if (traceStateHeader) {
          const state = Array.isArray(traceStateHeader) ? traceStateHeader.join(",") : traceStateHeader;
          spanContext.traceState = new TraceState_1.TraceState(typeof state === "string" ? state : void 0);
        }
        return api_1.trace.setSpanContext(context4, spanContext);
      }
      fields() {
        return [exports.TRACE_PARENT_HEADER, exports.TRACE_STATE_HEADER];
      }
    };
    exports.W3CTraceContextPropagator = W3CTraceContextPropagator2;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/rpc-metadata.js
var require_rpc_metadata = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/trace/rpc-metadata.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRPCMetadata = exports.deleteRPCMetadata = exports.setRPCMetadata = exports.RPCType = void 0;
    var api_1 = require_src();
    var RPC_METADATA_KEY = (0, api_1.createContextKey)("OpenTelemetry SDK Context Key RPC_METADATA");
    var RPCType;
    (function(RPCType2) {
      RPCType2["HTTP"] = "http";
    })(RPCType = exports.RPCType || (exports.RPCType = {}));
    function setRPCMetadata(context4, meta) {
      return context4.setValue(RPC_METADATA_KEY, meta);
    }
    __name(setRPCMetadata, "setRPCMetadata");
    exports.setRPCMetadata = setRPCMetadata;
    function deleteRPCMetadata(context4) {
      return context4.deleteValue(RPC_METADATA_KEY);
    }
    __name(deleteRPCMetadata, "deleteRPCMetadata");
    exports.deleteRPCMetadata = deleteRPCMetadata;
    function getRPCMetadata(context4) {
      return context4.getValue(RPC_METADATA_KEY);
    }
    __name(getRPCMetadata, "getRPCMetadata");
    exports.getRPCMetadata = getRPCMetadata;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/lodash.merge.js
var require_lodash_merge = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/lodash.merge.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isPlainObject = void 0;
    var objectTag = "[object Object]";
    var nullTag = "[object Null]";
    var undefinedTag = "[object Undefined]";
    var funcProto = Function.prototype;
    var funcToString = funcProto.toString;
    var objectCtorString = funcToString.call(Object);
    var getPrototypeOf = Object.getPrototypeOf;
    var objectProto = Object.prototype;
    var hasOwnProperty = objectProto.hasOwnProperty;
    var symToStringTag = Symbol ? Symbol.toStringTag : void 0;
    var nativeObjectToString = objectProto.toString;
    function isPlainObject(value) {
      if (!isObjectLike(value) || baseGetTag(value) !== objectTag) {
        return false;
      }
      const proto = getPrototypeOf(value);
      if (proto === null) {
        return true;
      }
      const Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
      return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) === objectCtorString;
    }
    __name(isPlainObject, "isPlainObject");
    exports.isPlainObject = isPlainObject;
    function isObjectLike(value) {
      return value != null && typeof value == "object";
    }
    __name(isObjectLike, "isObjectLike");
    function baseGetTag(value) {
      if (value == null) {
        return value === void 0 ? undefinedTag : nullTag;
      }
      return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
    }
    __name(baseGetTag, "baseGetTag");
    function getRawTag(value) {
      const isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
      let unmasked = false;
      try {
        value[symToStringTag] = void 0;
        unmasked = true;
      } catch {
      }
      const result = nativeObjectToString.call(value);
      if (unmasked) {
        if (isOwn) {
          value[symToStringTag] = tag;
        } else {
          delete value[symToStringTag];
        }
      }
      return result;
    }
    __name(getRawTag, "getRawTag");
    function objectToString(value) {
      return nativeObjectToString.call(value);
    }
    __name(objectToString, "objectToString");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/merge.js
var require_merge = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/merge.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.merge = void 0;
    var lodash_merge_1 = require_lodash_merge();
    var MAX_LEVEL = 20;
    function merge(...args) {
      let result = args.shift();
      const objects = /* @__PURE__ */ new WeakMap();
      while (args.length > 0) {
        result = mergeTwoObjects(result, args.shift(), 0, objects);
      }
      return result;
    }
    __name(merge, "merge");
    exports.merge = merge;
    function takeValue(value) {
      if (isArray(value)) {
        return value.slice();
      }
      return value;
    }
    __name(takeValue, "takeValue");
    function mergeTwoObjects(one, two, level = 0, objects) {
      let result;
      if (level > MAX_LEVEL) {
        return void 0;
      }
      level++;
      if (isPrimitive(one) || isPrimitive(two) || isFunction(two)) {
        result = takeValue(two);
      } else if (isArray(one)) {
        result = one.slice();
        if (isArray(two)) {
          for (let i = 0, j = two.length; i < j; i++) {
            result.push(takeValue(two[i]));
          }
        } else if (isObject(two)) {
          const keys = Object.keys(two);
          for (let i = 0, j = keys.length; i < j; i++) {
            const key = keys[i];
            result[key] = takeValue(two[key]);
          }
        }
      } else if (isObject(one)) {
        if (isObject(two)) {
          if (!shouldMerge(one, two)) {
            return two;
          }
          result = Object.assign({}, one);
          const keys = Object.keys(two);
          for (let i = 0, j = keys.length; i < j; i++) {
            const key = keys[i];
            const twoValue = two[key];
            if (isPrimitive(twoValue)) {
              if (typeof twoValue === "undefined") {
                delete result[key];
              } else {
                result[key] = twoValue;
              }
            } else {
              const obj1 = result[key];
              const obj2 = twoValue;
              if (wasObjectReferenced(one, key, objects) || wasObjectReferenced(two, key, objects)) {
                delete result[key];
              } else {
                if (isObject(obj1) && isObject(obj2)) {
                  const arr1 = objects.get(obj1) || [];
                  const arr2 = objects.get(obj2) || [];
                  arr1.push({ obj: one, key });
                  arr2.push({ obj: two, key });
                  objects.set(obj1, arr1);
                  objects.set(obj2, arr2);
                }
                result[key] = mergeTwoObjects(result[key], twoValue, level, objects);
              }
            }
          }
        } else {
          result = two;
        }
      }
      return result;
    }
    __name(mergeTwoObjects, "mergeTwoObjects");
    function wasObjectReferenced(obj, key, objects) {
      const arr = objects.get(obj[key]) || [];
      for (let i = 0, j = arr.length; i < j; i++) {
        const info3 = arr[i];
        if (info3.key === key && info3.obj === obj) {
          return true;
        }
      }
      return false;
    }
    __name(wasObjectReferenced, "wasObjectReferenced");
    function isArray(value) {
      return Array.isArray(value);
    }
    __name(isArray, "isArray");
    function isFunction(value) {
      return typeof value === "function";
    }
    __name(isFunction, "isFunction");
    function isObject(value) {
      return !isPrimitive(value) && !isArray(value) && !isFunction(value) && typeof value === "object";
    }
    __name(isObject, "isObject");
    function isPrimitive(value) {
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined" || value instanceof Date || value instanceof RegExp || value === null;
    }
    __name(isPrimitive, "isPrimitive");
    function shouldMerge(one, two) {
      if (!(0, lodash_merge_1.isPlainObject)(one) || !(0, lodash_merge_1.isPlainObject)(two)) {
        return false;
      }
      return true;
    }
    __name(shouldMerge, "shouldMerge");
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/timeout.js
var require_timeout = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/timeout.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.callWithTimeout = exports.TimeoutError = void 0;
    var TimeoutError = class _TimeoutError extends Error {
      static {
        __name(this, "TimeoutError");
      }
      constructor(message) {
        super(message);
        Object.setPrototypeOf(this, _TimeoutError.prototype);
      }
    };
    exports.TimeoutError = TimeoutError;
    function callWithTimeout(promise, timeout) {
      let timeoutHandle;
      const timeoutPromise = new Promise(/* @__PURE__ */ __name(function timeoutFunction(_resolve, reject) {
        timeoutHandle = setTimeout(/* @__PURE__ */ __name(function timeoutHandler() {
          reject(new TimeoutError("Operation timed out."));
        }, "timeoutHandler"), timeout);
      }, "timeoutFunction"));
      return Promise.race([promise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
      }, (reason) => {
        clearTimeout(timeoutHandle);
        throw reason;
      });
    }
    __name(callWithTimeout, "callWithTimeout");
    exports.callWithTimeout = callWithTimeout;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/url.js
var require_url = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/url.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isUrlIgnored = exports.urlMatches = void 0;
    function urlMatches(url, urlToMatch) {
      if (typeof urlToMatch === "string") {
        return url === urlToMatch;
      } else {
        return !!url.match(urlToMatch);
      }
    }
    __name(urlMatches, "urlMatches");
    exports.urlMatches = urlMatches;
    function isUrlIgnored(url, ignoredUrls) {
      if (!ignoredUrls) {
        return false;
      }
      for (const ignoreUrl of ignoredUrls) {
        if (urlMatches(url, ignoreUrl)) {
          return true;
        }
      }
      return false;
    }
    __name(isUrlIgnored, "isUrlIgnored");
    exports.isUrlIgnored = isUrlIgnored;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/promise.js
var require_promise = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/promise.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Deferred = void 0;
    var Deferred = class {
      static {
        __name(this, "Deferred");
      }
      _promise;
      _resolve;
      _reject;
      constructor() {
        this._promise = new Promise((resolve, reject) => {
          this._resolve = resolve;
          this._reject = reject;
        });
      }
      get promise() {
        return this._promise;
      }
      resolve(val) {
        this._resolve(val);
      }
      reject(err) {
        this._reject(err);
      }
    };
    exports.Deferred = Deferred;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/callback.js
var require_callback = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/callback.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BindOnceFuture = void 0;
    var promise_1 = require_promise();
    var BindOnceFuture = class {
      static {
        __name(this, "BindOnceFuture");
      }
      _callback;
      _that;
      _isCalled = false;
      _deferred = new promise_1.Deferred();
      constructor(_callback, _that) {
        this._callback = _callback;
        this._that = _that;
      }
      get isCalled() {
        return this._isCalled;
      }
      get promise() {
        return this._deferred.promise;
      }
      call(...args) {
        if (!this._isCalled) {
          this._isCalled = true;
          try {
            Promise.resolve(this._callback.call(this._that, ...args)).then((val) => this._deferred.resolve(val), (err) => this._deferred.reject(err));
          } catch (err) {
            this._deferred.reject(err);
          }
        }
        return this._deferred.promise;
      }
    };
    exports.BindOnceFuture = BindOnceFuture;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/configuration.js
var require_configuration = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/utils/configuration.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.diagLogLevelFromString = void 0;
    var api_1 = require_src();
    var logLevelMap = {
      ALL: api_1.DiagLogLevel.ALL,
      VERBOSE: api_1.DiagLogLevel.VERBOSE,
      DEBUG: api_1.DiagLogLevel.DEBUG,
      INFO: api_1.DiagLogLevel.INFO,
      WARN: api_1.DiagLogLevel.WARN,
      ERROR: api_1.DiagLogLevel.ERROR,
      NONE: api_1.DiagLogLevel.NONE
    };
    function diagLogLevelFromString(value) {
      if (value == null) {
        return void 0;
      }
      const resolvedLogLevel = logLevelMap[value.toUpperCase()];
      if (resolvedLogLevel == null) {
        api_1.diag.warn(`Unknown log level "${value}", expected one of ${Object.keys(logLevelMap)}, using default`);
        return api_1.DiagLogLevel.INFO;
      }
      return resolvedLogLevel;
    }
    __name(diagLogLevelFromString, "diagLogLevelFromString");
    exports.diagLogLevelFromString = diagLogLevelFromString;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/internal/exporter.js
var require_exporter = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/internal/exporter.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports._export = void 0;
    var api_1 = require_src();
    var suppress_tracing_1 = require_suppress_tracing();
    function _export(exporter, arg) {
      return new Promise((resolve) => {
        api_1.context.with((0, suppress_tracing_1.suppressTracing)(api_1.context.active()), () => {
          exporter.export(arg, (result) => {
            resolve(result);
          });
        });
      });
    }
    __name(_export, "_export");
    exports._export = _export;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/index.js
var require_src3 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+core@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/core/build/src/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.internal = exports.diagLogLevelFromString = exports.BindOnceFuture = exports.urlMatches = exports.isUrlIgnored = exports.callWithTimeout = exports.TimeoutError = exports.merge = exports.TraceState = exports.unsuppressTracing = exports.suppressTracing = exports.isTracingSuppressed = exports.setRPCMetadata = exports.getRPCMetadata = exports.deleteRPCMetadata = exports.RPCType = exports.parseTraceParent = exports.W3CTraceContextPropagator = exports.TRACE_STATE_HEADER = exports.TRACE_PARENT_HEADER = exports.CompositePropagator = exports.otperformance = exports.getStringListFromEnv = exports.getNumberFromEnv = exports.getBooleanFromEnv = exports.getStringFromEnv = exports._globalThis = exports.SDK_INFO = exports.parseKeyPairsIntoRecord = exports.ExportResultCode = exports.unrefTimer = exports.timeInputToHrTime = exports.millisToHrTime = exports.isTimeInputHrTime = exports.isTimeInput = exports.hrTimeToTimeStamp = exports.hrTimeToNanoseconds = exports.hrTimeToMilliseconds = exports.hrTimeToMicroseconds = exports.hrTimeDuration = exports.hrTime = exports.getTimeOrigin = exports.addHrTimes = exports.loggingErrorHandler = exports.setGlobalErrorHandler = exports.globalErrorHandler = exports.sanitizeAttributes = exports.isAttributeValue = exports.AnchoredClock = exports.W3CBaggagePropagator = void 0;
    var W3CBaggagePropagator_1 = require_W3CBaggagePropagator();
    Object.defineProperty(exports, "W3CBaggagePropagator", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return W3CBaggagePropagator_1.W3CBaggagePropagator;
    }, "get") });
    var anchored_clock_1 = require_anchored_clock();
    Object.defineProperty(exports, "AnchoredClock", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return anchored_clock_1.AnchoredClock;
    }, "get") });
    var attributes_1 = require_attributes();
    Object.defineProperty(exports, "isAttributeValue", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return attributes_1.isAttributeValue;
    }, "get") });
    Object.defineProperty(exports, "sanitizeAttributes", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return attributes_1.sanitizeAttributes;
    }, "get") });
    var global_error_handler_1 = require_global_error_handler();
    Object.defineProperty(exports, "globalErrorHandler", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return global_error_handler_1.globalErrorHandler;
    }, "get") });
    Object.defineProperty(exports, "setGlobalErrorHandler", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return global_error_handler_1.setGlobalErrorHandler;
    }, "get") });
    var logging_error_handler_1 = require_logging_error_handler();
    Object.defineProperty(exports, "loggingErrorHandler", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return logging_error_handler_1.loggingErrorHandler;
    }, "get") });
    var time_1 = require_time();
    Object.defineProperty(exports, "addHrTimes", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.addHrTimes;
    }, "get") });
    Object.defineProperty(exports, "getTimeOrigin", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.getTimeOrigin;
    }, "get") });
    Object.defineProperty(exports, "hrTime", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTime;
    }, "get") });
    Object.defineProperty(exports, "hrTimeDuration", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTimeDuration;
    }, "get") });
    Object.defineProperty(exports, "hrTimeToMicroseconds", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTimeToMicroseconds;
    }, "get") });
    Object.defineProperty(exports, "hrTimeToMilliseconds", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTimeToMilliseconds;
    }, "get") });
    Object.defineProperty(exports, "hrTimeToNanoseconds", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTimeToNanoseconds;
    }, "get") });
    Object.defineProperty(exports, "hrTimeToTimeStamp", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.hrTimeToTimeStamp;
    }, "get") });
    Object.defineProperty(exports, "isTimeInput", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.isTimeInput;
    }, "get") });
    Object.defineProperty(exports, "isTimeInputHrTime", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.isTimeInputHrTime;
    }, "get") });
    Object.defineProperty(exports, "millisToHrTime", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.millisToHrTime;
    }, "get") });
    Object.defineProperty(exports, "timeInputToHrTime", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return time_1.timeInputToHrTime;
    }, "get") });
    var timer_util_1 = require_timer_util();
    Object.defineProperty(exports, "unrefTimer", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timer_util_1.unrefTimer;
    }, "get") });
    var ExportResult_1 = require_ExportResult();
    Object.defineProperty(exports, "ExportResultCode", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return ExportResult_1.ExportResultCode;
    }, "get") });
    var utils_1 = require_utils3();
    Object.defineProperty(exports, "parseKeyPairsIntoRecord", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return utils_1.parseKeyPairsIntoRecord;
    }, "get") });
    var platform_1 = require_browser2();
    Object.defineProperty(exports, "SDK_INFO", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.SDK_INFO;
    }, "get") });
    Object.defineProperty(exports, "_globalThis", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1._globalThis;
    }, "get") });
    Object.defineProperty(exports, "getStringFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.getStringFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getBooleanFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.getBooleanFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getNumberFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.getNumberFromEnv;
    }, "get") });
    Object.defineProperty(exports, "getStringListFromEnv", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.getStringListFromEnv;
    }, "get") });
    Object.defineProperty(exports, "otperformance", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return platform_1.otperformance;
    }, "get") });
    var composite_1 = require_composite();
    Object.defineProperty(exports, "CompositePropagator", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return composite_1.CompositePropagator;
    }, "get") });
    var W3CTraceContextPropagator_1 = require_W3CTraceContextPropagator();
    Object.defineProperty(exports, "TRACE_PARENT_HEADER", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return W3CTraceContextPropagator_1.TRACE_PARENT_HEADER;
    }, "get") });
    Object.defineProperty(exports, "TRACE_STATE_HEADER", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return W3CTraceContextPropagator_1.TRACE_STATE_HEADER;
    }, "get") });
    Object.defineProperty(exports, "W3CTraceContextPropagator", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return W3CTraceContextPropagator_1.W3CTraceContextPropagator;
    }, "get") });
    Object.defineProperty(exports, "parseTraceParent", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return W3CTraceContextPropagator_1.parseTraceParent;
    }, "get") });
    var rpc_metadata_1 = require_rpc_metadata();
    Object.defineProperty(exports, "RPCType", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return rpc_metadata_1.RPCType;
    }, "get") });
    Object.defineProperty(exports, "deleteRPCMetadata", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return rpc_metadata_1.deleteRPCMetadata;
    }, "get") });
    Object.defineProperty(exports, "getRPCMetadata", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return rpc_metadata_1.getRPCMetadata;
    }, "get") });
    Object.defineProperty(exports, "setRPCMetadata", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return rpc_metadata_1.setRPCMetadata;
    }, "get") });
    var suppress_tracing_1 = require_suppress_tracing();
    Object.defineProperty(exports, "isTracingSuppressed", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return suppress_tracing_1.isTracingSuppressed;
    }, "get") });
    Object.defineProperty(exports, "suppressTracing", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return suppress_tracing_1.suppressTracing;
    }, "get") });
    Object.defineProperty(exports, "unsuppressTracing", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return suppress_tracing_1.unsuppressTracing;
    }, "get") });
    var TraceState_1 = require_TraceState();
    Object.defineProperty(exports, "TraceState", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return TraceState_1.TraceState;
    }, "get") });
    var merge_1 = require_merge();
    Object.defineProperty(exports, "merge", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return merge_1.merge;
    }, "get") });
    var timeout_1 = require_timeout();
    Object.defineProperty(exports, "TimeoutError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timeout_1.TimeoutError;
    }, "get") });
    Object.defineProperty(exports, "callWithTimeout", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timeout_1.callWithTimeout;
    }, "get") });
    var url_1 = require_url();
    Object.defineProperty(exports, "isUrlIgnored", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return url_1.isUrlIgnored;
    }, "get") });
    Object.defineProperty(exports, "urlMatches", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return url_1.urlMatches;
    }, "get") });
    var callback_1 = require_callback();
    Object.defineProperty(exports, "BindOnceFuture", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return callback_1.BindOnceFuture;
    }, "get") });
    var configuration_1 = require_configuration();
    Object.defineProperty(exports, "diagLogLevelFromString", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return configuration_1.diagLogLevelFromString;
    }, "get") });
    var exporter_1 = require_exporter();
    exports.internal = {
      _export: exporter_1._export
    };
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/OTLPExporterBase.js
var require_OTLPExporterBase = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/OTLPExporterBase.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.OTLPExporterBase = void 0;
    var OTLPExporterBase = class {
      static {
        __name(this, "OTLPExporterBase");
      }
      _delegate;
      constructor(_delegate) {
        this._delegate = _delegate;
      }
      /**
       * Export items.
       * @param items
       * @param resultCallback
       */
      export(items, resultCallback) {
        this._delegate.export(items, resultCallback);
      }
      forceFlush() {
        return this._delegate.forceFlush();
      }
      shutdown() {
        return this._delegate.shutdown();
      }
    };
    exports.OTLPExporterBase = OTLPExporterBase;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/types.js
var require_types2 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/types.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.OTLPExporterError = void 0;
    var OTLPExporterError2 = class extends Error {
      static {
        __name(this, "OTLPExporterError");
      }
      code;
      name = "OTLPExporterError";
      data;
      constructor(message, code, data) {
        super(message);
        this.data = data;
        this.code = code;
      }
    };
    exports.OTLPExporterError = OTLPExporterError2;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/configuration/shared-configuration.js
var require_shared_configuration = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/configuration/shared-configuration.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSharedConfigurationDefaults = exports.mergeOtlpSharedConfigurationWithDefaults = exports.wrapStaticHeadersInFunction = exports.validateTimeoutMillis = void 0;
    function validateTimeoutMillis(timeoutMillis) {
      if (Number.isFinite(timeoutMillis) && timeoutMillis > 0) {
        return timeoutMillis;
      }
      throw new Error(`Configuration: timeoutMillis is invalid, expected number greater than 0 (actual: '${timeoutMillis}')`);
    }
    __name(validateTimeoutMillis, "validateTimeoutMillis");
    exports.validateTimeoutMillis = validateTimeoutMillis;
    function wrapStaticHeadersInFunction(headers) {
      if (headers == null) {
        return void 0;
      }
      return async () => headers;
    }
    __name(wrapStaticHeadersInFunction, "wrapStaticHeadersInFunction");
    exports.wrapStaticHeadersInFunction = wrapStaticHeadersInFunction;
    function mergeOtlpSharedConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration) {
      return {
        timeoutMillis: validateTimeoutMillis(userProvidedConfiguration.timeoutMillis ?? fallbackConfiguration.timeoutMillis ?? defaultConfiguration.timeoutMillis),
        concurrencyLimit: userProvidedConfiguration.concurrencyLimit ?? fallbackConfiguration.concurrencyLimit ?? defaultConfiguration.concurrencyLimit,
        compression: userProvidedConfiguration.compression ?? fallbackConfiguration.compression ?? defaultConfiguration.compression
      };
    }
    __name(mergeOtlpSharedConfigurationWithDefaults, "mergeOtlpSharedConfigurationWithDefaults");
    exports.mergeOtlpSharedConfigurationWithDefaults = mergeOtlpSharedConfigurationWithDefaults;
    function getSharedConfigurationDefaults() {
      return {
        timeoutMillis: 1e4,
        concurrencyLimit: 30,
        compression: "none"
      };
    }
    __name(getSharedConfigurationDefaults, "getSharedConfigurationDefaults");
    exports.getSharedConfigurationDefaults = getSharedConfigurationDefaults;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/configuration/legacy-node-configuration.js
var require_legacy_node_configuration = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/configuration/legacy-node-configuration.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CompressionAlgorithm = void 0;
    var CompressionAlgorithm;
    (function(CompressionAlgorithm2) {
      CompressionAlgorithm2["NONE"] = "none";
      CompressionAlgorithm2["GZIP"] = "gzip";
    })(CompressionAlgorithm = exports.CompressionAlgorithm || (exports.CompressionAlgorithm = {}));
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/bounded-queue-export-promise-handler.js
var require_bounded_queue_export_promise_handler = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/bounded-queue-export-promise-handler.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createBoundedQueueExportPromiseHandler = void 0;
    var BoundedQueueExportPromiseHandler = class {
      static {
        __name(this, "BoundedQueueExportPromiseHandler");
      }
      _concurrencyLimit;
      _sendingPromises = [];
      /**
       * @param concurrencyLimit maximum promises allowed in a queue at the same time.
       */
      constructor(concurrencyLimit) {
        this._concurrencyLimit = concurrencyLimit;
      }
      pushPromise(promise) {
        if (this.hasReachedLimit()) {
          throw new Error("Concurrency Limit reached");
        }
        this._sendingPromises.push(promise);
        const popPromise = /* @__PURE__ */ __name(() => {
          const index = this._sendingPromises.indexOf(promise);
          void this._sendingPromises.splice(index, 1);
        }, "popPromise");
        promise.then(popPromise, popPromise);
      }
      hasReachedLimit() {
        return this._sendingPromises.length >= this._concurrencyLimit;
      }
      async awaitAll() {
        await Promise.all(this._sendingPromises);
      }
    };
    function createBoundedQueueExportPromiseHandler(options) {
      return new BoundedQueueExportPromiseHandler(options.concurrencyLimit);
    }
    __name(createBoundedQueueExportPromiseHandler, "createBoundedQueueExportPromiseHandler");
    exports.createBoundedQueueExportPromiseHandler = createBoundedQueueExportPromiseHandler;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/logging-response-handler.js
var require_logging_response_handler = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/logging-response-handler.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createLoggingPartialSuccessResponseHandler = void 0;
    var api_1 = require_src();
    function isPartialSuccessResponse(response) {
      return Object.prototype.hasOwnProperty.call(response, "partialSuccess");
    }
    __name(isPartialSuccessResponse, "isPartialSuccessResponse");
    function createLoggingPartialSuccessResponseHandler() {
      return {
        handleResponse(response) {
          if (response == null || !isPartialSuccessResponse(response) || response.partialSuccess == null || Object.keys(response.partialSuccess).length === 0) {
            return;
          }
          api_1.diag.warn("Received Partial Success response:", JSON.stringify(response.partialSuccess));
        }
      };
    }
    __name(createLoggingPartialSuccessResponseHandler, "createLoggingPartialSuccessResponseHandler");
    exports.createLoggingPartialSuccessResponseHandler = createLoggingPartialSuccessResponseHandler;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/otlp-export-delegate.js
var require_otlp_export_delegate = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/otlp-export-delegate.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createOtlpExportDelegate = void 0;
    var core_1 = require_src3();
    var types_1 = require_types2();
    var logging_response_handler_1 = require_logging_response_handler();
    var api_1 = require_src();
    var OTLPExportDelegate = class {
      static {
        __name(this, "OTLPExportDelegate");
      }
      _transport;
      _serializer;
      _responseHandler;
      _promiseQueue;
      _timeout;
      _diagLogger;
      constructor(_transport, _serializer, _responseHandler, _promiseQueue, _timeout) {
        this._transport = _transport;
        this._serializer = _serializer;
        this._responseHandler = _responseHandler;
        this._promiseQueue = _promiseQueue;
        this._timeout = _timeout;
        this._diagLogger = api_1.diag.createComponentLogger({
          namespace: "OTLPExportDelegate"
        });
      }
      export(internalRepresentation, resultCallback) {
        this._diagLogger.debug("items to be sent", internalRepresentation);
        if (this._promiseQueue.hasReachedLimit()) {
          resultCallback({
            code: core_1.ExportResultCode.FAILED,
            error: new Error("Concurrent export limit reached")
          });
          return;
        }
        const serializedRequest = this._serializer.serializeRequest(internalRepresentation);
        if (serializedRequest == null) {
          resultCallback({
            code: core_1.ExportResultCode.FAILED,
            error: new Error("Nothing to send")
          });
          return;
        }
        this._promiseQueue.pushPromise(this._transport.send(serializedRequest, this._timeout).then((response) => {
          if (response.status === "success") {
            if (response.data != null) {
              try {
                this._responseHandler.handleResponse(this._serializer.deserializeResponse(response.data));
              } catch (e) {
                this._diagLogger.warn("Export succeeded but could not deserialize response - is the response specification compliant?", e, response.data);
              }
            }
            resultCallback({
              code: core_1.ExportResultCode.SUCCESS
            });
            return;
          } else if (response.status === "failure" && response.error) {
            resultCallback({
              code: core_1.ExportResultCode.FAILED,
              error: response.error
            });
            return;
          } else if (response.status === "retryable") {
            resultCallback({
              code: core_1.ExportResultCode.FAILED,
              error: new types_1.OTLPExporterError("Export failed with retryable status")
            });
          } else {
            resultCallback({
              code: core_1.ExportResultCode.FAILED,
              error: new types_1.OTLPExporterError("Export failed with unknown error")
            });
          }
        }, (reason) => resultCallback({
          code: core_1.ExportResultCode.FAILED,
          error: reason
        })));
      }
      forceFlush() {
        return this._promiseQueue.awaitAll();
      }
      async shutdown() {
        this._diagLogger.debug("shutdown started");
        await this.forceFlush();
        this._transport.shutdown();
      }
    };
    function createOtlpExportDelegate(components, settings) {
      return new OTLPExportDelegate(components.transport, components.serializer, (0, logging_response_handler_1.createLoggingPartialSuccessResponseHandler)(), components.promiseHandler, settings.timeout);
    }
    __name(createOtlpExportDelegate, "createOtlpExportDelegate");
    exports.createOtlpExportDelegate = createOtlpExportDelegate;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/otlp-network-export-delegate.js
var require_otlp_network_export_delegate = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/otlp-network-export-delegate.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createOtlpNetworkExportDelegate = void 0;
    var bounded_queue_export_promise_handler_1 = require_bounded_queue_export_promise_handler();
    var otlp_export_delegate_1 = require_otlp_export_delegate();
    function createOtlpNetworkExportDelegate(options, serializer, transport) {
      return (0, otlp_export_delegate_1.createOtlpExportDelegate)({
        transport,
        serializer,
        promiseHandler: (0, bounded_queue_export_promise_handler_1.createBoundedQueueExportPromiseHandler)(options)
      }, { timeout: options.timeoutMillis });
    }
    __name(createOtlpNetworkExportDelegate, "createOtlpNetworkExportDelegate");
    exports.createOtlpNetworkExportDelegate = createOtlpNetworkExportDelegate;
  }
});

// ../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/index.js
var require_src4 = __commonJS({
  "../../node_modules/.pnpm/@opentelemetry+otlp-exporter-base@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-exporter-base/build/src/index.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createOtlpNetworkExportDelegate = exports.CompressionAlgorithm = exports.getSharedConfigurationDefaults = exports.mergeOtlpSharedConfigurationWithDefaults = exports.OTLPExporterError = exports.OTLPExporterBase = void 0;
    var OTLPExporterBase_1 = require_OTLPExporterBase();
    Object.defineProperty(exports, "OTLPExporterBase", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return OTLPExporterBase_1.OTLPExporterBase;
    }, "get") });
    var types_1 = require_types2();
    Object.defineProperty(exports, "OTLPExporterError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return types_1.OTLPExporterError;
    }, "get") });
    var shared_configuration_1 = require_shared_configuration();
    Object.defineProperty(exports, "mergeOtlpSharedConfigurationWithDefaults", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return shared_configuration_1.mergeOtlpSharedConfigurationWithDefaults;
    }, "get") });
    Object.defineProperty(exports, "getSharedConfigurationDefaults", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return shared_configuration_1.getSharedConfigurationDefaults;
    }, "get") });
    var legacy_node_configuration_1 = require_legacy_node_configuration();
    Object.defineProperty(exports, "CompressionAlgorithm", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return legacy_node_configuration_1.CompressionAlgorithm;
    }, "get") });
    var otlp_network_export_delegate_1 = require_otlp_network_export_delegate();
    Object.defineProperty(exports, "createOtlpNetworkExportDelegate", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return otlp_network_export_delegate_1.createOtlpNetworkExportDelegate;
    }, "get") });
  }
});

// src/actor-worker.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/actor.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/core/src/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
import { env as env2, DurableObject, WorkerEntrypoint } from "cloudflare:workers";

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/storage/src/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/storage/src/sql-schema-migrations.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _SQLSchemaMigrations_instances;
var _SQLSchemaMigrations__config;
var _SQLSchemaMigrations__migrations;
var _SQLSchemaMigrations__lastMigrationMonotonicId;
var _SQLSchemaMigrations__lastMigrationIDKeyName;
var SQLSchemaMigrations = class {
  static {
    __name(this, "SQLSchemaMigrations");
  }
  constructor(config2) {
    _SQLSchemaMigrations_instances.add(this);
    _SQLSchemaMigrations__config.set(this, void 0);
    _SQLSchemaMigrations__migrations.set(this, void 0);
    _SQLSchemaMigrations__lastMigrationMonotonicId.set(this, -1);
    __classPrivateFieldSet(this, _SQLSchemaMigrations__config, config2, "f");
    const migrations = [...config2.migrations];
    migrations.sort((a, b) => a.idMonotonicInc - b.idMonotonicInc);
    const idSeen = /* @__PURE__ */ new Set();
    migrations.forEach((m) => {
      if (m.idMonotonicInc < 0) {
        throw new Error(`migration ID cannot be negative: ${m.idMonotonicInc}`);
      }
      if (idSeen.has(m.idMonotonicInc)) {
        throw new Error(`duplicate migration ID detected: ${m.idMonotonicInc}`);
      }
      idSeen.add(m.idMonotonicInc);
    });
    __classPrivateFieldSet(this, _SQLSchemaMigrations__migrations, migrations, "f");
  }
  /**
   * This is a quick check based on the in memory tracker of last migration ran,
   * therefore this always returns `true` until `runAll` runs at least once.
   * @returns `true` if the `migrations` list provided has not been ran in full yet.
   */
  hasMigrationsToRun() {
    if (!__classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f").length) {
      return false;
    }
    return __classPrivateFieldGet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, "f") !== __classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f")[__classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f").length - 1].idMonotonicInc;
  }
  /**
   * Runs all the migrations that haven't already ran. The `idMonotonicInc` of each migration is used
   * to track which migrations ran or not. New migrations should always have higher `idMonotonicInc`
   * than older ones!
   *
   * @param sqlGen An optional callback function to generate the SQL statement of a given migration at runtime.
   *               If the migration entry already has a valid `sql` statement this callback is NOT called.
   * @returns The numbers of rows read and written throughout the migration execution.
   */
  async runAll(sqlGen) {
    const result = {
      rowsRead: 0,
      rowsWritten: 0
    };
    if (!this.hasMigrationsToRun()) {
      return result;
    }
    __classPrivateFieldSet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, await __classPrivateFieldGet(this, _SQLSchemaMigrations__config, "f").doStorage.get(__classPrivateFieldGet(this, _SQLSchemaMigrations_instances, "m", _SQLSchemaMigrations__lastMigrationIDKeyName).call(this)) ?? -1, "f");
    let idx = 0, sz = __classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f").length;
    while (idx < sz && __classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f")[idx].idMonotonicInc <= __classPrivateFieldGet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, "f")) {
      idx += 1;
    }
    if (idx >= sz) {
      return result;
    }
    const doSql = __classPrivateFieldGet(this, _SQLSchemaMigrations__config, "f").doStorage.sql;
    const migrationsToRun = __classPrivateFieldGet(this, _SQLSchemaMigrations__migrations, "f").slice(idx);
    await __classPrivateFieldGet(this, _SQLSchemaMigrations__config, "f").doStorage.transaction(async () => {
      let _lastMigrationMonotonicId = __classPrivateFieldGet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, "f");
      migrationsToRun.forEach((migration) => {
        let query = migration.sql ?? sqlGen?.(migration.idMonotonicInc);
        if (!query) {
          throw new Error(`migration with neither 'sql' nor 'sqlGen' provided: ${migration.idMonotonicInc}`);
        }
        const cursor = doSql.exec(query);
        let _ = cursor.toArray();
        result.rowsRead += cursor.rowsRead;
        result.rowsWritten += cursor.rowsWritten;
        _lastMigrationMonotonicId = migration.idMonotonicInc;
      });
      __classPrivateFieldSet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, _lastMigrationMonotonicId, "f");
      await __classPrivateFieldGet(this, _SQLSchemaMigrations__config, "f").doStorage.put(__classPrivateFieldGet(this, _SQLSchemaMigrations_instances, "m", _SQLSchemaMigrations__lastMigrationIDKeyName).call(this), __classPrivateFieldGet(this, _SQLSchemaMigrations__lastMigrationMonotonicId, "f"));
    });
    return result;
  }
};
_SQLSchemaMigrations__config = /* @__PURE__ */ new WeakMap(), _SQLSchemaMigrations__migrations = /* @__PURE__ */ new WeakMap(), _SQLSchemaMigrations__lastMigrationMonotonicId = /* @__PURE__ */ new WeakMap(), _SQLSchemaMigrations_instances = /* @__PURE__ */ new WeakSet(), _SQLSchemaMigrations__lastMigrationIDKeyName = /* @__PURE__ */ __name(function _SQLSchemaMigrations__lastMigrationIDKeyName2() {
  return "__sql_migrations_lastID";
}, "_SQLSchemaMigrations__lastMigrationIDKeyName");

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/storage/src/index.js
var Storage = class {
  static {
    __name(this, "Storage");
  }
  /**
   * Gets the current migrations array
   */
  get migrations() {
    return this._migrationsArray;
  }
  /**
   * Sets the migrations array and updates the SQLSchemaMigrations instance if available
   */
  set migrations(value) {
    this._migrationsArray = value;
    if (this.raw && this._migrations) {
      this._migrations = new SQLSchemaMigrations({
        doStorage: this.raw,
        migrations: value
      });
    }
  }
  /**
   * Creates a new instance of Storage.
   * @param sql - The SQL storage instance to use for queries
   * @param storage - The Durable Object storage instance
   */
  constructor(storage) {
    this._migrationsArray = [];
    this.hasRanMigrations = false;
    this.raw = storage;
    this.sqlStorage = storage?.sql;
    if (storage) {
      this._migrations = new SQLSchemaMigrations({
        doStorage: storage,
        migrations: this._migrationsArray
      });
    }
  }
  /**
   * Executes a raw SQL query with optional parameters.
   * @param opts - Options containing the SQL query and optional parameters
   * @returns Promise resolving to a cursor containing the query results
   * @throws Error if the SQL execution fails
   */
  async executeRawQuery(opts) {
    const { sql, params } = opts;
    try {
      let cursor;
      if (params && params.length) {
        cursor = this.sqlStorage?.exec(sql, ...params);
      } else {
        cursor = this.sqlStorage?.exec(sql);
      }
      if (!cursor) {
        console.log("No cursor returned from query");
        return null;
      }
      return cursor;
    } catch (error3) {
      console.error("SQL Execution Error:", error3);
      throw error3;
    }
  }
  /**
   * Execute SQL queries against the Agent's database
   * @template T Type of the returned rows
   * @param strings SQL query template strings
   * @param values Values to be inserted into the query
   * @returns Array of query results
   */
  sql(strings, ...values) {
    let query = "";
    try {
      query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
      if (!this.sqlStorage) {
        throw new Error("No SQL storage provided");
      }
      return [...this.sqlStorage.exec(query, ...values)];
    } catch (e) {
      console.error(`failed to execute sql query: ${query}`, e);
      throw e;
    }
  }
  /**
   * Executes a SQL query and formats the results based on the specified options.
   * @param opts - Options containing the SQL query, parameters, and result format preference
   * @returns Promise resolving to either raw query results or formatted array
   */
  async query(sql, params, isRaw) {
    const cursor = await this.executeRawQuery({ sql, params });
    if (!cursor)
      return [];
    if (isRaw) {
      return {
        columns: cursor.columnNames,
        rows: Array.from(cursor.raw()),
        meta: {
          rows_read: cursor.rowsRead,
          rows_written: cursor.rowsWritten
        }
      };
    }
    return cursor.toArray();
  }
  async runMigrations() {
    if (this.hasRanMigrations)
      return;
    if (!this._migrations) {
      throw new Error("No migrations provided");
    }
    const response = await this._migrations.runAll();
    this.hasRanMigrations = true;
    return response;
  }
  async __studio(cmd) {
    const storage = this.raw;
    if (cmd.type === "query") {
      return this.query(cmd.statement, cmd.params);
    } else if (cmd.type === "transaction") {
      return storage.transaction(async () => {
        const results = [];
        for (const statement of cmd.statements) {
          results.push(await this.query(statement, cmd.params, true));
        }
        return results;
      });
    }
  }
};

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/alarms/src/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/cron-schedule@5.0.4/node_modules/cron-schedule/dist/cron-parser.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/cron-schedule@5.0.4/node_modules/cron-schedule/dist/cron.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/cron-schedule@5.0.4/node_modules/cron-schedule/dist/utils.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function extractDateElements(date) {
  return {
    second: date.getSeconds(),
    minute: date.getMinutes(),
    hour: date.getHours(),
    day: date.getDate(),
    month: date.getMonth(),
    weekday: date.getDay(),
    year: date.getFullYear()
  };
}
__name(extractDateElements, "extractDateElements");
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
__name(getDaysInMonth, "getDaysInMonth");
function getDaysBetweenWeekdays(weekday1, weekday2) {
  if (weekday1 <= weekday2) {
    return weekday2 - weekday1;
  }
  return 6 - weekday1 + weekday2 + 1;
}
__name(getDaysBetweenWeekdays, "getDaysBetweenWeekdays");

// ../../node_modules/.pnpm/cron-schedule@5.0.4/node_modules/cron-schedule/dist/cron.js
var Cron = class {
  static {
    __name(this, "Cron");
  }
  constructor({ seconds, minutes, hours, days, months, weekdays }) {
    if (!seconds || seconds.size === 0)
      throw new Error("There must be at least one allowed second.");
    if (!minutes || minutes.size === 0)
      throw new Error("There must be at least one allowed minute.");
    if (!hours || hours.size === 0)
      throw new Error("There must be at least one allowed hour.");
    if (!months || months.size === 0)
      throw new Error("There must be at least one allowed month.");
    if ((!weekdays || weekdays.size === 0) && (!days || days.size === 0))
      throw new Error("There must be at least one allowed day or weekday.");
    this.seconds = Array.from(seconds).sort((a, b) => a - b);
    this.minutes = Array.from(minutes).sort((a, b) => a - b);
    this.hours = Array.from(hours).sort((a, b) => a - b);
    this.days = Array.from(days).sort((a, b) => a - b);
    this.months = Array.from(months).sort((a, b) => a - b);
    this.weekdays = Array.from(weekdays).sort((a, b) => a - b);
    const validateData = /* @__PURE__ */ __name((name, data, constraint) => {
      if (data.some((x) => typeof x !== "number" || x % 1 !== 0 || x < constraint.min || x > constraint.max)) {
        throw new Error(`${name} must only consist of integers which are within the range of ${constraint.min} and ${constraint.max}`);
      }
    }, "validateData");
    validateData("seconds", this.seconds, { min: 0, max: 59 });
    validateData("minutes", this.minutes, { min: 0, max: 59 });
    validateData("hours", this.hours, { min: 0, max: 23 });
    validateData("days", this.days, { min: 1, max: 31 });
    validateData("months", this.months, { min: 0, max: 11 });
    validateData("weekdays", this.weekdays, { min: 0, max: 6 });
    this.reversed = {
      seconds: this.seconds.map((x) => x).reverse(),
      minutes: this.minutes.map((x) => x).reverse(),
      hours: this.hours.map((x) => x).reverse(),
      days: this.days.map((x) => x).reverse(),
      months: this.months.map((x) => x).reverse(),
      weekdays: this.weekdays.map((x) => x).reverse()
    };
  }
  /**
   * Find the next or previous hour, starting from the given start hour that matches the hour constraint.
   * startHour itself might also be allowed.
   */
  findAllowedHour(dir3, startHour) {
    return dir3 === "next" ? this.hours.find((x) => x >= startHour) : this.reversed.hours.find((x) => x <= startHour);
  }
  /**
   * Find the next or previous minute, starting from the given start minute that matches the minute constraint.
   * startMinute itself might also be allowed.
   */
  findAllowedMinute(dir3, startMinute) {
    return dir3 === "next" ? this.minutes.find((x) => x >= startMinute) : this.reversed.minutes.find((x) => x <= startMinute);
  }
  /**
   * Find the next or previous second, starting from the given start second that matches the second constraint.
   * startSecond itself IS NOT allowed.
   */
  findAllowedSecond(dir3, startSecond) {
    return dir3 === "next" ? this.seconds.find((x) => x > startSecond) : this.reversed.seconds.find((x) => x < startSecond);
  }
  /**
   * Find the next or previous time, starting from the given start time that matches the hour, minute
   * and second constraints. startTime itself might also be allowed.
   */
  findAllowedTime(dir3, startTime) {
    let hour = this.findAllowedHour(dir3, startTime.hour);
    if (hour !== void 0) {
      if (hour === startTime.hour) {
        let minute = this.findAllowedMinute(dir3, startTime.minute);
        if (minute !== void 0) {
          if (minute === startTime.minute) {
            const second = this.findAllowedSecond(dir3, startTime.second);
            if (second !== void 0) {
              return { hour, minute, second };
            }
            minute = this.findAllowedMinute(dir3, dir3 === "next" ? startTime.minute + 1 : startTime.minute - 1);
            if (minute !== void 0) {
              return {
                hour,
                minute,
                second: dir3 === "next" ? this.seconds[0] : this.reversed.seconds[0]
              };
            }
          } else {
            return {
              hour,
              minute,
              second: dir3 === "next" ? this.seconds[0] : this.reversed.seconds[0]
            };
          }
        }
        hour = this.findAllowedHour(dir3, dir3 === "next" ? startTime.hour + 1 : startTime.hour - 1);
        if (hour !== void 0) {
          return {
            hour,
            minute: dir3 === "next" ? this.minutes[0] : this.reversed.minutes[0],
            second: dir3 === "next" ? this.seconds[0] : this.reversed.seconds[0]
          };
        }
      } else {
        return {
          hour,
          minute: dir3 === "next" ? this.minutes[0] : this.reversed.minutes[0],
          second: dir3 === "next" ? this.seconds[0] : this.reversed.seconds[0]
        };
      }
    }
    return void 0;
  }
  /**
   * Find the next or previous day in the given month, starting from the given startDay
   * that matches either the day or the weekday constraint. startDay itself might also be allowed.
   */
  findAllowedDayInMonth(dir3, year, month, startDay) {
    var _a, _b;
    if (startDay < 1)
      throw new Error("startDay must not be smaller than 1.");
    const daysInMonth = getDaysInMonth(year, month);
    const daysRestricted = this.days.length !== 31;
    const weekdaysRestricted = this.weekdays.length !== 7;
    if (!daysRestricted && !weekdaysRestricted) {
      if (startDay > daysInMonth) {
        return dir3 === "next" ? void 0 : daysInMonth;
      }
      return startDay;
    }
    let allowedDayByDays;
    if (daysRestricted) {
      allowedDayByDays = dir3 === "next" ? this.days.find((x) => x >= startDay) : this.reversed.days.find((x) => x <= startDay);
      if (allowedDayByDays !== void 0 && allowedDayByDays > daysInMonth) {
        allowedDayByDays = void 0;
      }
    }
    let allowedDayByWeekdays;
    if (weekdaysRestricted) {
      const startWeekday = new Date(year, month, startDay).getDay();
      const nearestAllowedWeekday = dir3 === "next" ? (_a = this.weekdays.find((x) => x >= startWeekday)) !== null && _a !== void 0 ? _a : this.weekdays[0] : (_b = this.reversed.weekdays.find((x) => x <= startWeekday)) !== null && _b !== void 0 ? _b : this.reversed.weekdays[0];
      if (nearestAllowedWeekday !== void 0) {
        const daysBetweenWeekdays = dir3 === "next" ? getDaysBetweenWeekdays(startWeekday, nearestAllowedWeekday) : getDaysBetweenWeekdays(nearestAllowedWeekday, startWeekday);
        allowedDayByWeekdays = dir3 === "next" ? startDay + daysBetweenWeekdays : startDay - daysBetweenWeekdays;
        if (allowedDayByWeekdays > daysInMonth || allowedDayByWeekdays < 1) {
          allowedDayByWeekdays = void 0;
        }
      }
    }
    if (allowedDayByDays !== void 0 && allowedDayByWeekdays !== void 0) {
      return dir3 === "next" ? Math.min(allowedDayByDays, allowedDayByWeekdays) : Math.max(allowedDayByDays, allowedDayByWeekdays);
    }
    if (allowedDayByDays !== void 0) {
      return allowedDayByDays;
    }
    if (allowedDayByWeekdays !== void 0) {
      return allowedDayByWeekdays;
    }
    return void 0;
  }
  /** Gets the next date starting from the given start date or now. */
  getNextDate(startDate = /* @__PURE__ */ new Date()) {
    const startDateElements = extractDateElements(startDate);
    let minYear = startDateElements.year;
    let startIndexMonth = this.months.findIndex((x) => x >= startDateElements.month);
    if (startIndexMonth === -1) {
      startIndexMonth = 0;
      minYear++;
    }
    const maxIterations = this.months.length * 5;
    for (let i = 0; i < maxIterations; i++) {
      const year = minYear + Math.floor((startIndexMonth + i) / this.months.length);
      const month = this.months[(startIndexMonth + i) % this.months.length];
      const isStartMonth = year === startDateElements.year && month === startDateElements.month;
      let day = this.findAllowedDayInMonth("next", year, month, isStartMonth ? startDateElements.day : 1);
      let isStartDay = isStartMonth && day === startDateElements.day;
      if (day !== void 0 && isStartDay) {
        const nextTime = this.findAllowedTime("next", startDateElements);
        if (nextTime !== void 0) {
          return new Date(year, month, day, nextTime.hour, nextTime.minute, nextTime.second);
        }
        day = this.findAllowedDayInMonth("next", year, month, day + 1);
        isStartDay = false;
      }
      if (day !== void 0 && !isStartDay) {
        return new Date(year, month, day, this.hours[0], this.minutes[0], this.seconds[0]);
      }
    }
    throw new Error("No valid next date was found.");
  }
  /** Gets the specified amount of future dates starting from the given start date or now. */
  getNextDates(amount, startDate) {
    const dates = [];
    let nextDate;
    for (let i = 0; i < amount; i++) {
      nextDate = this.getNextDate(nextDate !== null && nextDate !== void 0 ? nextDate : startDate);
      dates.push(nextDate);
    }
    return dates;
  }
  /**
   * Get an ES6 compatible iterator which iterates over the next dates starting from startDate or now.
   * The iterator runs until the optional endDate is reached or forever.
   */
  *getNextDatesIterator(startDate, endDate) {
    let nextDate;
    while (true) {
      nextDate = this.getNextDate(nextDate !== null && nextDate !== void 0 ? nextDate : startDate);
      if (endDate && endDate.getTime() < nextDate.getTime()) {
        return;
      }
      yield nextDate;
    }
  }
  /** Gets the previous date starting from the given start date or now. */
  getPrevDate(startDate = /* @__PURE__ */ new Date()) {
    const startDateElements = extractDateElements(startDate);
    let maxYear = startDateElements.year;
    let startIndexMonth = this.reversed.months.findIndex((x) => x <= startDateElements.month);
    if (startIndexMonth === -1) {
      startIndexMonth = 0;
      maxYear--;
    }
    const maxIterations = this.reversed.months.length * 5;
    for (let i = 0; i < maxIterations; i++) {
      const year = maxYear - Math.floor((startIndexMonth + i) / this.reversed.months.length);
      const month = this.reversed.months[(startIndexMonth + i) % this.reversed.months.length];
      const isStartMonth = year === startDateElements.year && month === startDateElements.month;
      let day = this.findAllowedDayInMonth("prev", year, month, isStartMonth ? startDateElements.day : (
        // Start searching from the last day of the month.
        getDaysInMonth(year, month)
      ));
      let isStartDay = isStartMonth && day === startDateElements.day;
      if (day !== void 0 && isStartDay) {
        const prevTime = this.findAllowedTime("prev", startDateElements);
        if (prevTime !== void 0) {
          return new Date(year, month, day, prevTime.hour, prevTime.minute, prevTime.second);
        }
        if (day > 1) {
          day = this.findAllowedDayInMonth("prev", year, month, day - 1);
          isStartDay = false;
        }
      }
      if (day !== void 0 && !isStartDay) {
        return new Date(year, month, day, this.reversed.hours[0], this.reversed.minutes[0], this.reversed.seconds[0]);
      }
    }
    throw new Error("No valid previous date was found.");
  }
  /** Gets the specified amount of previous dates starting from the given start date or now. */
  getPrevDates(amount, startDate) {
    const dates = [];
    let prevDate;
    for (let i = 0; i < amount; i++) {
      prevDate = this.getPrevDate(prevDate !== null && prevDate !== void 0 ? prevDate : startDate);
      dates.push(prevDate);
    }
    return dates;
  }
  /**
   * Get an ES6 compatible iterator which iterates over the previous dates starting from startDate or now.
   * The iterator runs until the optional endDate is reached or forever.
   */
  *getPrevDatesIterator(startDate, endDate) {
    let prevDate;
    while (true) {
      prevDate = this.getPrevDate(prevDate !== null && prevDate !== void 0 ? prevDate : startDate);
      if (endDate && endDate.getTime() > prevDate.getTime()) {
        return;
      }
      yield prevDate;
    }
  }
  /** Returns true when there is a cron date at the given date. */
  matchDate(date) {
    const { second, minute, hour, day, month, weekday } = extractDateElements(date);
    if (this.seconds.indexOf(second) === -1 || this.minutes.indexOf(minute) === -1 || this.hours.indexOf(hour) === -1 || this.months.indexOf(month) === -1) {
      return false;
    }
    if (this.days.length !== 31 && this.weekdays.length !== 7) {
      return this.days.indexOf(day) !== -1 || this.weekdays.indexOf(weekday) !== -1;
    }
    return this.days.indexOf(day) !== -1 && this.weekdays.indexOf(weekday) !== -1;
  }
};

// ../../node_modules/.pnpm/cron-schedule@5.0.4/node_modules/cron-schedule/dist/cron-parser.js
var secondConstraint = {
  min: 0,
  max: 59
};
var minuteConstraint = {
  min: 0,
  max: 59
};
var hourConstraint = {
  min: 0,
  max: 23
};
var dayConstraint = {
  min: 1,
  max: 31
};
var monthConstraint = {
  min: 1,
  max: 12,
  aliases: {
    jan: "1",
    feb: "2",
    mar: "3",
    apr: "4",
    may: "5",
    jun: "6",
    jul: "7",
    aug: "8",
    sep: "9",
    oct: "10",
    nov: "11",
    dec: "12"
  }
};
var weekdayConstraint = {
  min: 0,
  max: 7,
  aliases: {
    mon: "1",
    tue: "2",
    wed: "3",
    thu: "4",
    fri: "5",
    sat: "6",
    sun: "7"
  }
};
var timeNicknames = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@minutely": "* * * * *"
};
function parseElement(element, constraint) {
  const result = /* @__PURE__ */ new Set();
  if (element === "*") {
    for (let i = constraint.min; i <= constraint.max; i = i + 1) {
      result.add(i);
    }
    return result;
  }
  const listElements = element.split(",");
  if (listElements.length > 1) {
    for (const listElement of listElements) {
      const parsedListElement = parseElement(listElement, constraint);
      for (const x of parsedListElement) {
        result.add(x);
      }
    }
    return result;
  }
  const parseSingleElement = /* @__PURE__ */ __name((singleElement) => {
    var _a, _b;
    singleElement = (_b = (_a = constraint.aliases) === null || _a === void 0 ? void 0 : _a[singleElement.toLowerCase()]) !== null && _b !== void 0 ? _b : singleElement;
    const parsedElement = Number.parseInt(singleElement, 10);
    if (Number.isNaN(parsedElement)) {
      throw new Error(`Failed to parse ${element}: ${singleElement} is NaN.`);
    }
    if (parsedElement < constraint.min || parsedElement > constraint.max) {
      throw new Error(`Failed to parse ${element}: ${singleElement} is outside of constraint range of ${constraint.min} - ${constraint.max}.`);
    }
    return parsedElement;
  }, "parseSingleElement");
  const rangeSegments = /^(([0-9a-zA-Z]+)-([0-9a-zA-Z]+)|\*)(\/([0-9]+))?$/.exec(element);
  if (rangeSegments === null) {
    result.add(parseSingleElement(element));
    return result;
  }
  let parsedStart = rangeSegments[1] === "*" ? constraint.min : parseSingleElement(rangeSegments[2]);
  const parsedEnd = rangeSegments[1] === "*" ? constraint.max : parseSingleElement(rangeSegments[3]);
  if (constraint === weekdayConstraint && parsedStart === 7 && // this check ensures that sun-sun is not incorrectly parsed as [0,1,2,3,4,5,6]
  parsedEnd !== 7) {
    parsedStart = 0;
  }
  if (parsedStart > parsedEnd) {
    throw new Error(`Failed to parse ${element}: Invalid range (start: ${parsedStart}, end: ${parsedEnd}).`);
  }
  const step = rangeSegments[5];
  let parsedStep = 1;
  if (step !== void 0) {
    parsedStep = Number.parseInt(step, 10);
    if (Number.isNaN(parsedStep)) {
      throw new Error(`Failed to parse step: ${step} is NaN.`);
    }
    if (parsedStep < 1) {
      throw new Error(`Failed to parse step: Expected ${step} to be greater than 0.`);
    }
  }
  for (let i = parsedStart; i <= parsedEnd; i = i + parsedStep) {
    result.add(i);
  }
  return result;
}
__name(parseElement, "parseElement");
function parseCronExpression(cronExpression) {
  var _a;
  if (typeof cronExpression !== "string") {
    throw new TypeError("Invalid cron expression: must be of type string.");
  }
  cronExpression = (_a = timeNicknames[cronExpression.toLowerCase()]) !== null && _a !== void 0 ? _a : cronExpression;
  const elements = cronExpression.split(" ").filter((elem) => elem.length > 0);
  if (elements.length < 5 || elements.length > 6) {
    throw new Error("Invalid cron expression: expected 5 or 6 elements.");
  }
  const rawSeconds = elements.length === 6 ? elements[0] : "0";
  const rawMinutes = elements.length === 6 ? elements[1] : elements[0];
  const rawHours = elements.length === 6 ? elements[2] : elements[1];
  const rawDays = elements.length === 6 ? elements[3] : elements[2];
  const rawMonths = elements.length === 6 ? elements[4] : elements[3];
  const rawWeekdays = elements.length === 6 ? elements[5] : elements[4];
  return new Cron({
    seconds: parseElement(rawSeconds, secondConstraint),
    minutes: parseElement(rawMinutes, minuteConstraint),
    hours: parseElement(rawHours, hourConstraint),
    days: parseElement(rawDays, dayConstraint),
    // months in cron are indexed by 1, but Cron expects indexes by 0, so we need to reduce all set values by one.
    months: new Set(Array.from(parseElement(rawMonths, monthConstraint)).map((x) => x - 1)),
    weekdays: new Set(Array.from(parseElement(rawWeekdays, weekdayConstraint)).map((x) => x % 7))
  });
}
__name(parseCronExpression, "parseCronExpression");

// ../../node_modules/.pnpm/nanoid@5.1.6/node_modules/nanoid/index.browser.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/nanoid@5.1.6/node_modules/nanoid/url-alphabet/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

// ../../node_modules/.pnpm/nanoid@5.1.6/node_modules/nanoid/index.browser.js
var nanoid = /* @__PURE__ */ __name((size = 21) => {
  let id = "";
  let bytes = crypto.getRandomValues(new Uint8Array(size |= 0));
  while (size--) {
    id += urlAlphabet[bytes[size] & 63];
  }
  return id;
}, "nanoid");

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/alarms/src/index.js
function getNextCronTime(cron) {
  const interval = parseCronExpression(cron);
  return interval.getNextDate();
}
__name(getNextCronTime, "getNextCronTime");
var Alarms = class {
  static {
    __name(this, "Alarms");
  }
  constructor(ctx, parent) {
    this.alarm = async (alarmInfo) => {
      const now = Math.floor(Date.now() / 1e3);
      const result = this.sql`
          SELECT *, COALESCE(identifier, 'default') as identifier FROM _actor_alarms WHERE time <= ${now}
        `;
      for (const row of result || []) {
        const callback = this.parent[row.callback];
        if (!callback) {
          console.error(`callback ${row.callback} not found`);
          continue;
        }
        try {
          const identifier = row.identifier || "default";
          this.parent.setName(identifier);
        } catch (error3) {
          console.error(`error setting identifier`, error3);
        }
        try {
          await callback.bind(this.parent)(JSON.parse(row.payload), row);
        } catch (e) {
          console.error(`error executing callback "${row.callback}"`, e);
        }
        if (row.type === "cron") {
          const nextExecutionTime = getNextCronTime(row.cron);
          const nextTimestamp = Math.floor(nextExecutionTime.getTime() / 1e3);
          this.sql`
              UPDATE _actor_alarms SET time = ${nextTimestamp} WHERE id = ${row.id}
            `;
        } else {
          this.sql`
              DELETE FROM _actor_alarms WHERE id = ${row.id}
            `;
        }
      }
      await this._scheduleNextAlarm();
    };
    this.storage = ctx?.storage;
    this.parent = parent;
    void ctx?.blockConcurrencyWhile(async () => {
      return this._tryCatch(async () => {
        ctx?.storage.sql.exec(`
                CREATE TABLE IF NOT EXISTS _actor_alarms (
                    id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
                    callback TEXT,
                    payload TEXT,
                    type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed', 'cron')),
                    time INTEGER,
                    delayInSeconds INTEGER,
                    cron TEXT,
                    created_at INTEGER DEFAULT (unixepoch())
                )
            `);
        try {
          ctx?.storage.sql.exec(`SELECT identifier FROM _actor_alarms LIMIT 1`);
        } catch (error3) {
          try {
            ctx?.storage.sql.exec(`ALTER TABLE _actor_alarms ADD COLUMN identifier TEXT DEFAULT 'default'`);
          } catch (addError) {
            console.error("Failed to add identifier column:", addError);
          }
        }
        await this.alarm();
      });
    });
  }
  /**
   * Schedule a task to be executed in the future
   * @template T Type of the payload data
   * @param when When to execute the task (Date, seconds delay, or cron expression)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = nanoid(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string");
    }
    if (typeof this.parent[callback] !== "function") {
      throw new Error(`this.parent.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
            INSERT OR REPLACE INTO _actor_alarms (id, callback, payload, type, time, identifier)
            VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp}, ${this.actorName ?? "default"})
          `;
      await this._scheduleNextAlarm();
      return {
        id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled",
        identifier: this.actorName ?? "default"
      };
    }
    if (typeof when === "number") {
      const time3 = new Date(Date.now() + when * 1e3);
      const timestamp = Math.floor(time3.getTime() / 1e3);
      this.sql`
            INSERT OR REPLACE INTO _actor_alarms (id, callback, payload, type, delayInSeconds, time, identifier)
            VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${timestamp}, ${this.actorName ?? "default"})
          `;
      await this._scheduleNextAlarm();
      return {
        id,
        callback,
        payload,
        delayInSeconds: when,
        time: timestamp,
        type: "delayed",
        identifier: this.actorName ?? "default"
      };
    }
    if (typeof when === "string") {
      const nextExecutionTime = getNextCronTime(when);
      const timestamp = Math.floor(nextExecutionTime.getTime() / 1e3);
      this.sql`
            INSERT OR REPLACE INTO _actor_alarms (id, callback, payload, type, cron, time, identifier)
            VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'cron', ${when}, ${timestamp}, ${this.actorName ?? "default"})
          `;
      await this._scheduleNextAlarm();
      return {
        id,
        callback,
        payload,
        cron: when,
        time: timestamp,
        type: "cron",
        identifier: this.actorName ?? "default"
      };
    }
    throw new Error("Invalid schedule type");
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
          SELECT * FROM _actor_alarms WHERE id = ${id}
        `;
    if (!result) {
      console.error(`schedule ${id} not found`);
      return void 0;
    }
    return { ...result[0], payload: JSON.parse(result[0].payload) };
  }
  /**
   * Get scheduled tasks matching the given criteria
   * @template T Type of the payload data
   * @param criteria Criteria to filter schedules
   * @returns Array of matching Schedule objects
   */
  getSchedules(criteria = {}) {
    let query = "SELECT * FROM _actor_alarms WHERE 1=1";
    const params = [];
    if (criteria.id) {
      query += " AND id = ?";
      params.push(criteria.id);
    }
    if (criteria.type) {
      query += " AND type = ?";
      params.push(criteria.type);
    }
    if (criteria.timeRange) {
      query += " AND time >= ? AND time <= ?";
      const start = criteria.timeRange.start || /* @__PURE__ */ new Date(0);
      const end = criteria.timeRange.end || /* @__PURE__ */ new Date(999999999999999);
      params.push(Math.floor(start.getTime() / 1e3), Math.floor(end.getTime() / 1e3));
    }
    if (!this.storage?.sql) {
      return [];
    }
    const result = this.storage.sql.exec(query, ...params).toArray().map((row) => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
    return result;
  }
  /**
   * Cancel a scheduled task
   * @param id ID of the task to cancel
   * @returns true if the task was cancelled, false otherwise
   */
  async cancelSchedule(id) {
    this.sql`DELETE FROM _actor_alarms WHERE id = ${id}`;
    await this._scheduleNextAlarm();
    return true;
  }
  async _scheduleNextAlarm() {
    const result = this.sql`
          SELECT time, COALESCE(identifier, 'default') as identifier FROM _actor_alarms 
          WHERE time > ${Math.floor(Date.now() / 1e3)}
          ORDER BY time ASC 
          LIMIT 1
        `;
    if (!result || !this.storage)
      return;
    if (result.length > 0 && "time" in result[0]) {
      const nextTime = result[0].time * 1e3;
      await this.storage.setAlarm(nextTime);
    }
  }
  /**
   * Execute SQL queries against the Agent's database
   * @template T Type of the returned rows
   * @param strings SQL query template strings
   * @param values Values to be inserted into the query
   * @returns Array of query results
   */
  sql(strings, ...values) {
    let query = "";
    try {
      query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
      if (!this.storage) {
        throw new Error("Storage not initialized");
      }
      return [...this.storage.sql.exec(query, ...values)];
    } catch (e) {
      console.error(`failed to execute sql query: ${query}`, e);
      throw e;
    }
  }
  async _tryCatch(fn) {
    try {
      return await fn();
    } catch (e) {
      throw e;
    }
  }
};

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/sockets/src/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var Sockets = class {
  static {
    __name(this, "Sockets");
  }
  constructor(ctx, parent) {
    this.connections = /* @__PURE__ */ new Map();
    this.context = ctx;
    this.parent = parent;
    if (ctx) {
      const webSockets = ctx.getWebSockets();
      this.connections = /* @__PURE__ */ new Map();
      webSockets.forEach((socket) => {
        const attachment = socket.deserializeAttachment?.() || {};
        const connectionId = attachment.connectionId || crypto.randomUUID();
        this.connections.set(connectionId, socket);
      });
    }
  }
  message(message, to, exclude) {
    for (const [id, socket] of this.connections.entries()) {
      if (exclude?.includes(id) || exclude?.includes(socket)) {
        continue;
      }
      if (to === "*" || !to?.length || to.includes(id) || to.includes(socket)) {
        socket.send(message);
      }
    }
  }
  async webSocketMessage(ws, message) {
  }
  async webSocketClose(ws, code) {
    for (const [id, socket] of this.connections.entries()) {
      if (socket === ws) {
        this.connections.delete(id);
        break;
      }
    }
    ws.close(code, "Durable Object is closing WebSocket");
  }
  acceptWebSocket(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    const url = new URL(request.url);
    const params = url.searchParams;
    const queryParams = {};
    params.forEach((value, key) => {
      queryParams[key] = value;
    });
    const connectionId = queryParams.id || crypto.randomUUID();
    if (!queryParams.id) {
      queryParams.id = connectionId;
    }
    if (server.serializeAttachment) {
      server.serializeAttachment({
        connectionId,
        queryParams
      });
    }
    this.connections.set(connectionId, server);
    this.context?.acceptWebSocket(server);
    return { client, server };
  }
};

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/core/src/persist.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var PERSISTED_PROPERTIES = Symbol("PERSISTED_PROPERTIES");
var PERSISTED_VALUES = Symbol("PERSISTED_VALUES");
var IS_PROXIED = Symbol("IS_PROXIED");
function createDeepProxy(value, instance, propertyKey, triggerPersist) {
  if (value === null || value === void 0 || typeof value !== "object" || typeof value === "function") {
    return value;
  }
  try {
    if (value[IS_PROXIED] === true) {
      return value;
    }
  } catch (e) {
  }
  if (value instanceof Date || value instanceof RegExp || value instanceof Error || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }
  const proxy = new Proxy(value, {
    get(target, key) {
      if (key === IS_PROXIED)
        return true;
      if (typeof key === "symbol" || key === "toString" || key === "valueOf" || key === "constructor" || key === "toJSON") {
        return Reflect.get(target, key);
      }
      try {
        if (!Reflect.has(target, key)) {
          const newObj = {};
          Reflect.set(target, key, newObj);
          return createDeepProxy(newObj, instance, propertyKey, triggerPersist);
        }
        const prop = Reflect.get(target, key);
        if ((prop === null || prop === void 0) && typeof key === "string" && !key.startsWith("_") && key !== "length") {
          const newObj = {};
          Reflect.set(target, key, newObj);
          return createDeepProxy(newObj, instance, propertyKey, triggerPersist);
        }
        if (Array.isArray(target) && typeof prop === "function") {
          const mutatingArrayMethods = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"];
          if (mutatingArrayMethods.includes(key)) {
            return function(...args) {
              const result = prop.apply(target, args);
              triggerPersist();
              return result;
            };
          }
        }
        if ((target instanceof Map || target instanceof Set) && typeof prop === "function") {
          const mutatingCollectionMethods = ["set", "delete", "clear", "add"];
          if (mutatingCollectionMethods.includes(key)) {
            return function(...args) {
              const result = prop.apply(target, args);
              triggerPersist();
              return result;
            };
          }
        }
        if (prop !== null && typeof prop === "object" && !Object.isFrozen(prop)) {
          return createDeepProxy(prop, instance, propertyKey, triggerPersist);
        }
        return prop;
      } catch (e) {
        console.error(`Error accessing property ${String(key)}:`, e);
        const newObj = {};
        Reflect.set(target, key, newObj);
        return createDeepProxy(newObj, instance, propertyKey, triggerPersist);
      }
    },
    set(target, key, newValue) {
      if (typeof key === "symbol") {
        Reflect.set(target, key, newValue);
        return true;
      }
      try {
        const currentValue = Reflect.get(target, key);
        if (currentValue !== null && typeof currentValue === "object" && newValue !== null && typeof newValue === "object" && !Array.isArray(currentValue) && !Array.isArray(newValue)) {
          Object.assign(currentValue, newValue);
        } else if (newValue !== null && typeof newValue === "object" && !Object.isFrozen(newValue)) {
          const proxiedValue = createDeepProxy(newValue, instance, propertyKey, triggerPersist);
          Reflect.set(target, key, proxiedValue);
        } else {
          Reflect.set(target, key, newValue);
        }
        triggerPersist();
        return true;
      } catch (e) {
        const error3 = e;
        console.error(`Error setting property ${String(key)}:`, error3);
        try {
          if (error3.message && error3.message.includes("Cannot create property")) {
            const emptyObj = {};
            Reflect.set(target, key, createDeepProxy(emptyObj, instance, propertyKey, triggerPersist));
            return true;
          }
        } catch (recoveryErr) {
          console.error("Error during recovery attempt:", recoveryErr);
        }
        return false;
      }
    },
    deleteProperty(target, key) {
      try {
        if (Reflect.has(target, key)) {
          Reflect.deleteProperty(target, key);
          triggerPersist();
        }
        return true;
      } catch (e) {
        console.error(`Error deleting property ${String(key)}:`, e);
        return false;
      }
    }
  });
  return proxy;
}
__name(createDeepProxy, "createDeepProxy");
async function initializePersistedProperties(instance) {
  if (!instance.storage?.raw)
    return;
  try {
    await instance.storage.__studio({
      type: "query",
      statement: "CREATE TABLE IF NOT EXISTS _actor_persist (property TEXT PRIMARY KEY, value TEXT)"
    });
    const constructor = instance.constructor;
    const persistedProps = constructor[PERSISTED_PROPERTIES];
    if (!persistedProps || persistedProps.size === 0)
      return;
    if (!instance[PERSISTED_VALUES]) {
      instance[PERSISTED_VALUES] = /* @__PURE__ */ new Map();
    }
    const results = await instance.storage.__studio({
      type: "query",
      statement: "SELECT property, value FROM _actor_persist"
    });
    for (const row of results) {
      if (persistedProps.has(row.property)) {
        try {
          let ensureObjectStructure = function(target, template) {
            if (target === null || typeof target !== "object" || template === null || typeof template !== "object") {
              return;
            }
            for (const key in template) {
              if (template[key] !== null && typeof template[key] === "object") {
                if (!target[key] || typeof target[key] !== "object") {
                  target[key] = Array.isArray(template[key]) ? [] : {};
                }
                ensureObjectStructure(target[key], template[key]);
              }
            }
          };
          __name(ensureObjectStructure, "ensureObjectStructure");
          let parsedValue;
          try {
            parsedValue = safeParse(row.value);
            if (parsedValue && parsedValue.__error === "Serialization failed") {
              console.warn(`Property ${row.property} had serialization issues: ${parsedValue.value}`);
              parsedValue = typeof parsedValue.value === "string" ? parsedValue.value : {};
            }
            const initialValue = instance[row.property];
            if (initialValue !== void 0 && typeof initialValue === "object" && initialValue !== null) {
              if (typeof parsedValue !== "object" || parsedValue === null) {
                console.warn(`Property ${row.property} type mismatch: expected object, got ${typeof parsedValue}. Resetting to initial structure.`);
                parsedValue = structuredClone(initialValue);
              } else {
                ensureObjectStructure(parsedValue, initialValue);
              }
            }
          } catch (parseErr) {
            console.error(`Failed to parse persisted value for ${row.property}:`, parseErr);
            parsedValue = {};
          }
          const triggerPersist = /* @__PURE__ */ __name(() => {
            const currentValue = instance[PERSISTED_VALUES].get(row.property);
            if (instance.storage?.raw) {
              instance._persistProperty(row.property, currentValue).catch((err) => {
                console.error(`Failed to persist property ${row.property}:`, err);
              });
            }
          }, "triggerPersist");
          const proxiedValue = parsedValue !== null && typeof parsedValue === "object" ? createDeepProxy(parsedValue, instance, row.property, triggerPersist) : parsedValue;
          instance[PERSISTED_VALUES].set(row.property, proxiedValue);
        } catch (err) {
          console.error(`Failed to process persisted value for ${row.property}:`, err);
          instance[PERSISTED_VALUES].set(row.property, {});
        }
      }
    }
  } catch (err) {
    console.error("Error initializing persisted properties:", err);
  }
}
__name(initializePersistedProperties, "initializePersistedProperties");
function safeStringify(obj) {
  const seen = /* @__PURE__ */ new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Date) {
      return { __type: "Date", value: value.toISOString() };
    }
    if (value instanceof RegExp) {
      return { __type: "RegExp", source: value.source, flags: value.flags };
    }
    if (value instanceof Error) {
      return { __type: "Error", message: value.message, stack: value.stack };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}
__name(safeStringify, "safeStringify");
function safeParse(json) {
  return JSON.parse(json, (key, value) => {
    if (value && typeof value === "object" && value.__type) {
      switch (value.__type) {
        case "Date":
          return new Date(value.value);
        case "RegExp":
          return new RegExp(value.source, value.flags);
        case "Error":
          const error3 = new Error(value.message);
          error3.stack = value.stack;
          return error3;
      }
    }
    return value;
  });
}
__name(safeParse, "safeParse");
async function persistProperty(instance, propertyKey, value) {
  if (!instance.storage?.raw)
    return;
  try {
    let rawValue = value;
    let serializedValue;
    try {
      serializedValue = safeStringify(rawValue);
    } catch (jsonErr) {
      console.error(`Failed to serialize property ${propertyKey}:`, jsonErr);
      serializedValue = JSON.stringify({ __error: "Serialization failed", value: String(rawValue) });
    }
    await instance.storage.__studio({
      type: "query",
      statement: "INSERT INTO _actor_persist (property, value) VALUES (?, ?) ON CONFLICT(property) DO UPDATE SET value = ?",
      params: [propertyKey, serializedValue, serializedValue]
    });
    if (typeof instance.onPersist === "function") {
      try {
        await instance.onPersist(propertyKey, value);
      } catch (hookErr) {
        console.error(`Error in onPersist hook for property ${propertyKey}:`, hookErr);
      }
    }
  } catch (err) {
    console.error(`Error persisting property ${propertyKey}:`, err);
    throw err;
  }
}
__name(persistProperty, "persistProperty");

// ../../node_modules/.pnpm/@cloudflare+actors@0.0.1-beta.6/node_modules/@cloudflare/actors/dist/core/src/index.js
var DEFAULT_ACTOR_NAME = "default";
var TRACKING_ACTOR_NAME = "_cf_actors";
var Actor = class extends DurableObject {
  static {
    __name(this, "Actor");
  }
  get name() {
    return this._name;
  }
  __studio(_) {
    return this.storage.__studio(_);
  }
  /**
   * Set the identifier for the actor as named by the client
   * @param id The identifier to set
   */
  async setName(id) {
    this.identifier = id;
    this._name = id;
    this._setNameCalled = true;
    this.alarms.actorName = this.identifier;
    if (!this._onInitCalled) {
      this._onInitCalled = true;
      await this.onInit();
    }
  }
  /**
   * Static method to extract an ID from a request URL. Default response "default".
   * @param request - The incoming request
   * @returns The name string value defined by the client application to reference an instance
   */
  static async nameFromRequest(request) {
    return DEFAULT_ACTOR_NAME;
  }
  /**
   * Static method to get an actor instance by ID
   * @param id - The ID of the actor to get
   * @returns The actor instance
   */
  static get(id) {
    const stub = getActor(this, id);
    stub.setName(id);
    return stub;
  }
  /**
   * Creates a new instance of Actor.
   * @param ctx - The DurableObjectState for this actor
   * @param env - The environment object containing bindings and configuration
   */
  constructor(ctx, env3) {
    if (ctx && env3) {
      super(ctx, env3);
    } else {
      super();
    }
    this._onInitCalled = false;
    this._setNameCalled = false;
    if (ctx && env3) {
      this.storage = new Storage(ctx.storage);
      this.alarms = new Alarms(ctx, this);
      this.sockets = new Sockets(ctx, this);
      this[PERSISTED_VALUES] = /* @__PURE__ */ new Map();
      ctx.blockConcurrencyWhile(async () => {
        await this._initializePersistedProperties();
      });
    } else {
      this.storage = new Storage(void 0);
      this.alarms = new Alarms(void 0, this);
      this.sockets = new Sockets(void 0, this);
      this[PERSISTED_VALUES] = /* @__PURE__ */ new Map();
    }
    if (!this.identifier) {
      this.identifier = DEFAULT_ACTOR_NAME;
    }
    if (!this.name) {
      this._name = DEFAULT_ACTOR_NAME;
    }
  }
  /**
   * Initializes the persisted properties table and loads any stored values.
   * This is called during construction to ensure properties are loaded before any code uses them.
   * @private
   */
  async _initializePersistedProperties() {
    await initializePersistedProperties(this);
  }
  /**
   * Waits for setName to be called before proceeding with request handling.
   * This ensures that onRequest has access to the correct identifier.
   * @private
   */
  async _waitForSetName() {
    const timeout = 5e3;
    const startTime = Date.now();
    while (!this._setNameCalled) {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        throw new Error(`setName() was not called within ${timeout}ms. Actor may not be properly initialized.`);
      }
      await scheduler.wait(0);
    }
  }
  /**
   * Persists a property value to the Durable Object storage.
   * @param propertyKey The name of the property to persist
   * @param value The value to persist
   * @private
   */
  async _persistProperty(propertyKey, value) {
    await persistProperty(this, propertyKey, value);
  }
  /**
   * Abstract method that must be implemented by derived classes to handle incoming requests.
   * @param request - The incoming request to handle
   * @returns A Promise that resolves to a Response
   */
  async fetch(request) {
    const config2 = this.constructor.configuration(request);
    const url = new URL(request.url);
    const upgradePath = config2?.sockets?.upgradePath ?? "/ws";
    if (url.pathname === upgradePath || url.pathname.startsWith(`${upgradePath}/`)) {
      const shouldUpgrade = this.shouldUpgradeSocket(request);
      if (shouldUpgrade) {
        return Promise.resolve(this.onWebSocketUpgrade(request));
      }
    }
    if (config2?.sockets?.autoResponse) {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(config2.sockets.autoResponse.ping, config2.sockets.autoResponse.pong));
    }
    if (!this._setNameCalled) {
      try {
        await this._waitForSetName();
      } catch (error3) {
        console.error("Failed to wait for setName:", error3);
        return new Response("Actor initialization timeout", { status: 503 });
      }
    }
    return this.onRequest(request);
  }
  /**
   * Lifecycle method that is called when the actor is initialized.
   * @protected
   */
  async onInit() {
  }
  /**
   * Lifecycle method that is called when the actor is notified of an alarm.
   * @protected
   * @param alarmInfo - Information about the alarm that was triggered
   */
  async onAlarm(alarmInfo) {
  }
  /**
   * Hook that is called whenever a @Persist decorated property is stored in the database.
   * Override this method to listen to persistence events.
   * @param key The property key that was persisted
   * @param value The value that was persisted
   */
  onPersist(key, value) {
  }
  onRequest(request) {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }
  shouldUpgradeSocket(request) {
    return false;
  }
  // Only need to override if you want to handle the socket upgrade yourself.
  // Otherwise this is all handled for you automatically.
  onWebSocketUpgrade(request) {
    const { client, server } = this.sockets.acceptWebSocket(request);
    const response = new Response(null, {
      status: 101,
      webSocket: client
    });
    Promise.resolve().then(() => {
      this.onWebSocketConnect(server, request);
    });
    return response;
  }
  onWebSocketConnect(ws, request) {
  }
  onWebSocketDisconnect(ws) {
  }
  onWebSocketMessage(ws, message) {
  }
  async webSocketMessage(ws, message) {
    this.sockets.webSocketMessage(ws, message);
    this.onWebSocketMessage(ws, message);
  }
  async webSocketClose(ws, code) {
    this.sockets.webSocketClose(ws, code);
    this.onWebSocketDisconnect(ws);
  }
  async alarm(alarmInfo) {
    await this.onAlarm(alarmInfo);
    if (this.alarms) {
      return this.alarms.alarm(alarmInfo);
    }
    return;
  }
  /**
   * Execute SQL queries against the Agent's database
   * @template T Type of the returned rows
   * @param strings SQL query template strings
   * @param values Values to be inserted into the query
   * @returns Array of query results
   */
  sql(strings, ...values) {
    let query = "";
    try {
      query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
      return [...this.ctx.storage.sql.exec(query, ...values)];
    } catch (e) {
      console.error(`failed to execute sql query: ${query}`, e);
      throw e;
    }
  }
  /**
   * Tracks the last access time of an actor instance.
   * @param idString The identifier of the actor instance to track.
   */
  async track(idString) {
    if (TRACKING_ACTOR_NAME === idString) {
      throw new Error(`Cannot track instance with same name as tracking instance, change value to differ from "${TRACKING_ACTOR_NAME}"`);
    }
    const trackingStub = getActor(this.constructor, TRACKING_ACTOR_NAME);
    const currentDateTime = (/* @__PURE__ */ new Date()).toISOString();
    await trackingStub.__studio({ type: "query", statement: "CREATE TABLE IF NOT EXISTS actors (identifier TEXT PRIMARY KEY, last_accessed TEXT)" });
    await trackingStub.__studio({ type: "query", statement: `INSERT INTO actors (identifier, last_accessed) VALUES (?, ?) ON CONFLICT(identifier) DO UPDATE SET last_accessed = ?`, params: [idString, currentDateTime, currentDateTime] });
  }
  /**
   * Destroy the Actor by removing all actor library specific tables and state
   * that is associated with the actor.
   * @param _ - Optional configuration object
   * @param _.trackingInstance - Optional tracking instance name
   * @param _.forceEviction - When true, forces eviction of the actor from the cache
   * @throws Will throw an exception when forceEviction is true
   */
  async destroy(_) {
    if (this.name) {
      try {
        const trackerActor = getActor(this.constructor, TRACKING_ACTOR_NAME);
        if (trackerActor) {
          await trackerActor.sql`DELETE FROM actors WHERE identifier = ${this.name};`;
        }
      } catch (e) {
        console.error(`Failed to delete actor from tracking instance: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (_?.forceEviction) {
      this.ctx.abort("destroyed");
    }
  }
};
Actor.configuration = (request) => {
  return {
    locationHint: void 0,
    sockets: {
      upgradePath: "/ws"
    }
  };
};
function getActor(ActorClass, id) {
  const className = ActorClass.name;
  const envObj = env2;
  const locationHint = ActorClass.configuration().locationHint;
  const bindingName = Object.keys(envObj).find((key) => {
    const binding2 = env2.__DURABLE_OBJECT_BINDINGS?.[key];
    return key === className || binding2?.class_name === className;
  });
  if (!bindingName) {
    throw new Error(`No Durable Object binding found for actor class ${className}. Check update your wrangler.jsonc to match the binding "name" and "class_name" to be the same as the class name.`);
  }
  const namespace = envObj[bindingName];
  const stub = namespace.getByName(id, { locationHint });
  stub.setName(id);
  return stub;
}
__name(getActor, "getActor");

// ../../packages/autotel-cloudflare/dist/actors.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_api3 = __toESM(require_src(), 1);

// ../../packages/autotel-edge/dist/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../packages/autotel-edge/dist/chunk-ADMIROH3.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_core3 = __toESM(require_src3(), 1);
var import_otlp_exporter_base = __toESM(require_src4(), 1);

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/common/utils.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_core = __toESM(require_src3());

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/common/hex-to-binary.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function intValue(charCode) {
  if (charCode >= 48 && charCode <= 57) {
    return charCode - 48;
  }
  if (charCode >= 97 && charCode <= 102) {
    return charCode - 87;
  }
  return charCode - 55;
}
__name(intValue, "intValue");
function hexToBinary(hexStr) {
  const buf = new Uint8Array(hexStr.length / 2);
  let offset = 0;
  for (let i = 0; i < hexStr.length; i += 2) {
    const hi = intValue(hexStr.charCodeAt(i));
    const lo = intValue(hexStr.charCodeAt(i + 1));
    buf[offset++] = hi << 4 | lo;
  }
  return buf;
}
__name(hexToBinary, "hexToBinary");

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/common/utils.js
function hrTimeToNanos(hrTime) {
  const NANOSECONDS = BigInt(1e9);
  return BigInt(Math.trunc(hrTime[0])) * NANOSECONDS + BigInt(Math.trunc(hrTime[1]));
}
__name(hrTimeToNanos, "hrTimeToNanos");
function toLongBits(value) {
  const low = Number(BigInt.asUintN(32, value));
  const high = Number(BigInt.asUintN(32, value >> BigInt(32)));
  return { low, high };
}
__name(toLongBits, "toLongBits");
function encodeAsLongBits(hrTime) {
  const nanos = hrTimeToNanos(hrTime);
  return toLongBits(nanos);
}
__name(encodeAsLongBits, "encodeAsLongBits");
function encodeAsString(hrTime) {
  const nanos = hrTimeToNanos(hrTime);
  return nanos.toString();
}
__name(encodeAsString, "encodeAsString");
var encodeTimestamp = typeof BigInt !== "undefined" ? encodeAsString : import_core.hrTimeToNanoseconds;
function identity(value) {
  return value;
}
__name(identity, "identity");
function optionalHexToBinary(str) {
  if (str === void 0)
    return void 0;
  return hexToBinary(str);
}
__name(optionalHexToBinary, "optionalHexToBinary");
var DEFAULT_ENCODER = {
  encodeHrTime: encodeAsLongBits,
  encodeSpanContext: hexToBinary,
  encodeOptionalSpanContext: optionalHexToBinary
};
function getOtlpEncoder(options) {
  if (options === void 0) {
    return DEFAULT_ENCODER;
  }
  const useLongBits = options.useLongBits ?? true;
  const useHex = options.useHex ?? false;
  return {
    encodeHrTime: useLongBits ? encodeAsLongBits : encodeTimestamp,
    encodeSpanContext: useHex ? identity : hexToBinary,
    encodeOptionalSpanContext: useHex ? identity : optionalHexToBinary
  };
}
__name(getOtlpEncoder, "getOtlpEncoder");

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/common/internal.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function createResource(resource) {
  const result = {
    attributes: toAttributes(resource.attributes),
    droppedAttributesCount: 0
  };
  const schemaUrl = resource.schemaUrl;
  if (schemaUrl && schemaUrl !== "")
    result.schemaUrl = schemaUrl;
  return result;
}
__name(createResource, "createResource");
function createInstrumentationScope(scope) {
  return {
    name: scope.name,
    version: scope.version
  };
}
__name(createInstrumentationScope, "createInstrumentationScope");
function toAttributes(attributes) {
  return Object.keys(attributes).map((key) => toKeyValue(key, attributes[key]));
}
__name(toAttributes, "toAttributes");
function toKeyValue(key, value) {
  return {
    key,
    value: toAnyValue(value)
  };
}
__name(toKeyValue, "toKeyValue");
function toAnyValue(value) {
  const t = typeof value;
  if (t === "string")
    return { stringValue: value };
  if (t === "number") {
    if (!Number.isInteger(value))
      return { doubleValue: value };
    return { intValue: value };
  }
  if (t === "boolean")
    return { boolValue: value };
  if (value instanceof Uint8Array)
    return { bytesValue: value };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(toAnyValue) } };
  if (t === "object" && value != null)
    return {
      kvlistValue: {
        values: Object.entries(value).map(([k, v]) => toKeyValue(k, v))
      }
    };
  return {};
}
__name(toAnyValue, "toAnyValue");

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/trace/internal.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK = 256;
var SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK = 512;
function buildSpanFlagsFrom(traceFlags, isRemote) {
  let flags = traceFlags & 255 | SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK;
  if (isRemote) {
    flags |= SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK;
  }
  return flags;
}
__name(buildSpanFlagsFrom, "buildSpanFlagsFrom");
function sdkSpanToOtlpSpan(span, encoder) {
  const ctx = span.spanContext();
  const status = span.status;
  const parentSpanId = span.parentSpanContext?.spanId ? encoder.encodeSpanContext(span.parentSpanContext?.spanId) : void 0;
  return {
    traceId: encoder.encodeSpanContext(ctx.traceId),
    spanId: encoder.encodeSpanContext(ctx.spanId),
    parentSpanId,
    traceState: ctx.traceState?.serialize(),
    name: span.name,
    // Span kind is offset by 1 because the API does not define a value for unset
    kind: span.kind == null ? 0 : span.kind + 1,
    startTimeUnixNano: encoder.encodeHrTime(span.startTime),
    endTimeUnixNano: encoder.encodeHrTime(span.endTime),
    attributes: toAttributes(span.attributes),
    droppedAttributesCount: span.droppedAttributesCount,
    events: span.events.map((event) => toOtlpSpanEvent(event, encoder)),
    droppedEventsCount: span.droppedEventsCount,
    status: {
      // API and proto enums share the same values
      code: status.code,
      message: status.message
    },
    links: span.links.map((link) => toOtlpLink(link, encoder)),
    droppedLinksCount: span.droppedLinksCount,
    flags: buildSpanFlagsFrom(ctx.traceFlags, span.parentSpanContext?.isRemote)
  };
}
__name(sdkSpanToOtlpSpan, "sdkSpanToOtlpSpan");
function toOtlpLink(link, encoder) {
  return {
    attributes: link.attributes ? toAttributes(link.attributes) : [],
    spanId: encoder.encodeSpanContext(link.context.spanId),
    traceId: encoder.encodeSpanContext(link.context.traceId),
    traceState: link.context.traceState?.serialize(),
    droppedAttributesCount: link.droppedAttributesCount || 0,
    flags: buildSpanFlagsFrom(link.context.traceFlags, link.context.isRemote)
  };
}
__name(toOtlpLink, "toOtlpLink");
function toOtlpSpanEvent(timedEvent, encoder) {
  return {
    attributes: timedEvent.attributes ? toAttributes(timedEvent.attributes) : [],
    name: timedEvent.name,
    timeUnixNano: encoder.encodeHrTime(timedEvent.time),
    droppedAttributesCount: timedEvent.droppedAttributesCount || 0
  };
}
__name(toOtlpSpanEvent, "toOtlpSpanEvent");
function createExportTraceServiceRequest(spans, options) {
  const encoder = getOtlpEncoder(options);
  return {
    resourceSpans: spanRecordsToResourceSpans(spans, encoder)
  };
}
__name(createExportTraceServiceRequest, "createExportTraceServiceRequest");
function createResourceMap(readableSpans) {
  const resourceMap = /* @__PURE__ */ new Map();
  for (const record of readableSpans) {
    let ilsMap = resourceMap.get(record.resource);
    if (!ilsMap) {
      ilsMap = /* @__PURE__ */ new Map();
      resourceMap.set(record.resource, ilsMap);
    }
    const instrumentationScopeKey = `${record.instrumentationScope.name}@${record.instrumentationScope.version || ""}:${record.instrumentationScope.schemaUrl || ""}`;
    let records = ilsMap.get(instrumentationScopeKey);
    if (!records) {
      records = [];
      ilsMap.set(instrumentationScopeKey, records);
    }
    records.push(record);
  }
  return resourceMap;
}
__name(createResourceMap, "createResourceMap");
function spanRecordsToResourceSpans(readableSpans, encoder) {
  const resourceMap = createResourceMap(readableSpans);
  const out = [];
  const entryIterator = resourceMap.entries();
  let entry = entryIterator.next();
  while (!entry.done) {
    const [resource, ilmMap] = entry.value;
    const scopeResourceSpans = [];
    const ilmIterator = ilmMap.values();
    let ilmEntry = ilmIterator.next();
    while (!ilmEntry.done) {
      const scopeSpans = ilmEntry.value;
      if (scopeSpans.length > 0) {
        const spans = scopeSpans.map((readableSpan) => sdkSpanToOtlpSpan(readableSpan, encoder));
        scopeResourceSpans.push({
          scope: createInstrumentationScope(scopeSpans[0].instrumentationScope),
          spans,
          schemaUrl: scopeSpans[0].instrumentationScope.schemaUrl
        });
      }
      ilmEntry = ilmIterator.next();
    }
    const processedResource = createResource(resource);
    const transformedSpans = {
      resource: processedResource,
      scopeSpans: scopeResourceSpans,
      schemaUrl: processedResource.schemaUrl
    };
    out.push(transformedSpans);
    entry = entryIterator.next();
  }
  return out;
}
__name(spanRecordsToResourceSpans, "spanRecordsToResourceSpans");

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/trace/json/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@opentelemetry+otlp-transformer@0.208.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/otlp-transformer/build/esm/trace/json/trace.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var JsonTraceSerializer = {
  serializeRequest: /* @__PURE__ */ __name((arg) => {
    const request = createExportTraceServiceRequest(arg, {
      useHex: true,
      useLongBits: false
    });
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(request));
  }, "serializeRequest"),
  deserializeResponse: /* @__PURE__ */ __name((arg) => {
    if (arg.length === 0) {
      return {};
    }
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(arg));
  }, "deserializeResponse")
};

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/sampler/AlwaysOffSampler.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/Sampler.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var SamplingDecision;
(function(SamplingDecision2) {
  SamplingDecision2[SamplingDecision2["NOT_RECORD"] = 0] = "NOT_RECORD";
  SamplingDecision2[SamplingDecision2["RECORD"] = 1] = "RECORD";
  SamplingDecision2[SamplingDecision2["RECORD_AND_SAMPLED"] = 2] = "RECORD_AND_SAMPLED";
})(SamplingDecision || (SamplingDecision = {}));

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/sampler/AlwaysOffSampler.js
var AlwaysOffSampler = class {
  static {
    __name(this, "AlwaysOffSampler");
  }
  shouldSample() {
    return {
      decision: SamplingDecision.NOT_RECORD
    };
  }
  toString() {
    return "AlwaysOffSampler";
  }
};

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/sampler/AlwaysOnSampler.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var AlwaysOnSampler = class {
  static {
    __name(this, "AlwaysOnSampler");
  }
  shouldSample() {
    return {
      decision: SamplingDecision.RECORD_AND_SAMPLED
    };
  }
  toString() {
    return "AlwaysOnSampler";
  }
};

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/sampler/ParentBasedSampler.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_api = __toESM(require_src());
var import_core2 = __toESM(require_src3());
var ParentBasedSampler = class {
  static {
    __name(this, "ParentBasedSampler");
  }
  _root;
  _remoteParentSampled;
  _remoteParentNotSampled;
  _localParentSampled;
  _localParentNotSampled;
  constructor(config2) {
    this._root = config2.root;
    if (!this._root) {
      (0, import_core2.globalErrorHandler)(new Error("ParentBasedSampler must have a root sampler configured"));
      this._root = new AlwaysOnSampler();
    }
    this._remoteParentSampled = config2.remoteParentSampled ?? new AlwaysOnSampler();
    this._remoteParentNotSampled = config2.remoteParentNotSampled ?? new AlwaysOffSampler();
    this._localParentSampled = config2.localParentSampled ?? new AlwaysOnSampler();
    this._localParentNotSampled = config2.localParentNotSampled ?? new AlwaysOffSampler();
  }
  shouldSample(context4, traceId, spanName, spanKind, attributes, links) {
    const parentContext = import_api.trace.getSpanContext(context4);
    if (!parentContext || !(0, import_api.isSpanContextValid)(parentContext)) {
      return this._root.shouldSample(context4, traceId, spanName, spanKind, attributes, links);
    }
    if (parentContext.isRemote) {
      if (parentContext.traceFlags & import_api.TraceFlags.SAMPLED) {
        return this._remoteParentSampled.shouldSample(context4, traceId, spanName, spanKind, attributes, links);
      }
      return this._remoteParentNotSampled.shouldSample(context4, traceId, spanName, spanKind, attributes, links);
    }
    if (parentContext.traceFlags & import_api.TraceFlags.SAMPLED) {
      return this._localParentSampled.shouldSample(context4, traceId, spanName, spanKind, attributes, links);
    }
    return this._localParentNotSampled.shouldSample(context4, traceId, spanName, spanKind, attributes, links);
  }
  toString() {
    return `ParentBased{root=${this._root.toString()}, remoteParentSampled=${this._remoteParentSampled.toString()}, remoteParentNotSampled=${this._remoteParentNotSampled.toString()}, localParentSampled=${this._localParentSampled.toString()}, localParentNotSampled=${this._localParentNotSampled.toString()}}`;
  }
};

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/platform/browser/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// ../../node_modules/.pnpm/@opentelemetry+sdk-trace-base@2.2.0_@opentelemetry+api@1.9.0/node_modules/@opentelemetry/sdk-trace-base/build/esm/platform/browser/RandomIdGenerator.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var SPAN_ID_BYTES = 8;
var TRACE_ID_BYTES = 16;
var RandomIdGenerator = class {
  static {
    __name(this, "RandomIdGenerator");
  }
  /**
   * Returns a random 16-byte trace ID formatted/encoded as a 32 lowercase hex
   * characters corresponding to 128 bits.
   */
  generateTraceId = getIdGenerator(TRACE_ID_BYTES);
  /**
   * Returns a random 8-byte span ID formatted/encoded as a 16 lowercase hex
   * characters corresponding to 64 bits.
   */
  generateSpanId = getIdGenerator(SPAN_ID_BYTES);
};
var SHARED_CHAR_CODES_ARRAY = Array(32);
function getIdGenerator(bytes) {
  return /* @__PURE__ */ __name(function generateId() {
    for (let i = 0; i < bytes * 2; i++) {
      SHARED_CHAR_CODES_ARRAY[i] = Math.floor(Math.random() * 16) + 48;
      if (SHARED_CHAR_CODES_ARRAY[i] >= 58) {
        SHARED_CHAR_CODES_ARRAY[i] += 39;
      }
    }
    return String.fromCharCode.apply(null, SHARED_CHAR_CODES_ARRAY.slice(0, bytes * 2));
  }, "generateId");
}
__name(getIdGenerator, "getIdGenerator");

// ../../packages/autotel-edge/dist/chunk-ADMIROH3.js
var import_api2 = __toESM(require_src(), 1);
var PACKAGE_VERSION = "3.0.0";
var defaultHeaders = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": `autotel-edge v${PACKAGE_VERSION}`
};
var OTLPExporter = class {
  static {
    __name(this, "OTLPExporter");
  }
  headers;
  url;
  constructor(config2) {
    this.url = config2.url;
    this.headers = Object.assign({}, defaultHeaders, config2.headers);
  }
  export(items, resultCallback) {
    this._export(items).then(() => {
      resultCallback({ code: import_core3.ExportResultCode.SUCCESS });
    }).catch((error3) => {
      resultCallback({ code: import_core3.ExportResultCode.FAILED, error: error3 });
    });
  }
  _export(items) {
    return new Promise((resolve, reject) => {
      try {
        this.send(items, resolve, reject);
      } catch (error3) {
        reject(error3);
      }
    });
  }
  send(items, onSuccess, onError) {
    const decoder = new TextDecoder();
    const exportMessage = JsonTraceSerializer.serializeRequest(items);
    const body = decoder.decode(exportMessage);
    const params = {
      method: "POST",
      headers: this.headers,
      body
    };
    fetch(this.url, params).then((response) => {
      if (response.ok) {
        onSuccess();
      } else {
        onError(
          new import_otlp_exporter_base.OTLPExporterError(
            `Exporter received a statusCode: ${response.status}`
          )
        );
      }
    }).catch((error3) => {
      onError(
        new import_otlp_exporter_base.OTLPExporterError(
          `Exception during export: ${error3.toString()}`,
          error3.code,
          error3.stack
        )
      );
    });
  }
  async shutdown() {
  }
};
function isSpanProcessorConfig(config2) {
  return !!config2.spanProcessors;
}
__name(isSpanProcessorConfig, "isSpanProcessorConfig");
var SpanProcessorWithFlush = class {
  static {
    __name(this, "SpanProcessorWithFlush");
  }
  exporter;
  postProcessor;
  spans = /* @__PURE__ */ new Map();
  constructor(exporter, postProcessor) {
    this.exporter = exporter;
    this.postProcessor = postProcessor;
  }
  onStart(_span, _parentContext) {
  }
  onEnd(span) {
    const traceId = span.spanContext().traceId;
    if (!this.spans.has(traceId)) {
      this.spans.set(traceId, []);
    }
    this.spans.get(traceId).push(span);
  }
  /**
   * Force flush spans for a specific trace
   */
  async forceFlush(traceId) {
    if (traceId) {
      const spans = this.spans.get(traceId);
      if (spans && spans.length > 0) {
        await this.exportSpans(spans);
        this.spans.delete(traceId);
      }
    } else {
      const promises = [];
      for (const [id, spans] of this.spans.entries()) {
        promises.push(this.exportSpans(spans));
        this.spans.delete(id);
      }
      await Promise.all(promises);
    }
  }
  async shutdown() {
    await this.forceFlush();
    if (this.exporter) {
      await this.exporter.shutdown();
    }
  }
  /**
   * Export spans with post-processing
   * Errors are caught and logged but don't throw to prevent worker instability
   */
  async exportSpans(spans) {
    if (spans.length === 0) return;
    if (!this.exporter) return;
    let processedSpans = spans;
    if (this.postProcessor) {
      try {
        processedSpans = this.postProcessor(spans);
      } catch (error3) {
        console.error("[autotel-edge] Post-processor error:", error3);
        processedSpans = spans;
      }
    }
    return new Promise((resolve) => {
      this.exporter.export(processedSpans, (result) => {
        if (result.code === 0) {
          resolve();
        } else {
          console.error(
            "[autotel-edge] Exporter error:",
            result.error?.message || "Unknown error"
          );
          resolve();
        }
      });
    });
  }
};
var TailSamplingSpanProcessor = class {
  static {
    __name(this, "TailSamplingSpanProcessor");
  }
  wrapped;
  tailSampler;
  traces = /* @__PURE__ */ new Map();
  constructor(exporter, postProcessor, tailSampler) {
    this.wrapped = new SpanProcessorWithFlush(exporter, postProcessor);
    this.tailSampler = tailSampler;
  }
  onStart(span, parentContext) {
    this.wrapped.onStart(span, parentContext);
  }
  onEnd(span) {
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    const parentSpanId = "parentSpanId" in span ? span.parentSpanId : void 0;
    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        spans: [],
        localRootSpan: void 0
        // Will be set when we identify the local root
      });
    }
    const trace5 = this.traces.get(traceId);
    const hasLocalParent = parentSpanId && trace5.spans.some((s) => s.spanContext().spanId === parentSpanId);
    if (!hasLocalParent) {
      trace5.localRootSpan = span;
    }
    trace5.spans.push(span);
    const isDefinitiveRoot = !parentSpanId;
    const shouldAutoFlush = isDefinitiveRoot && trace5.localRootSpan && trace5.localRootSpan.spanContext().spanId === spanId;
    if (shouldAutoFlush) {
      if (this.tailSampler) {
        const shouldKeep = this.tailSampler(trace5);
        if (shouldKeep) {
          for (const bufferedSpan of trace5.spans) {
            this.wrapped.onEnd(bufferedSpan);
          }
          void this.wrapped.forceFlush(traceId);
        }
      } else {
        for (const bufferedSpan of trace5.spans) {
          this.wrapped.onEnd(bufferedSpan);
        }
        void this.wrapped.forceFlush(traceId);
      }
      this.traces.delete(traceId);
    }
  }
  async forceFlush(traceId) {
    if (traceId) {
      const trace5 = this.traces.get(traceId);
      if (trace5) {
        if (!trace5.localRootSpan && trace5.spans.length > 0) {
          trace5.localRootSpan = trace5.spans[0];
        }
        if (this.tailSampler) {
          const shouldKeep = this.tailSampler(trace5);
          if (shouldKeep) {
            for (const bufferedSpan of trace5.spans) {
              this.wrapped.onEnd(bufferedSpan);
            }
          }
        } else {
          for (const bufferedSpan of trace5.spans) {
            this.wrapped.onEnd(bufferedSpan);
          }
        }
        this.traces.delete(traceId);
      }
    }
    return this.wrapped.forceFlush(traceId);
  }
  async shutdown() {
    this.traces.clear();
    return this.wrapped.shutdown();
  }
};
var CONFIG_KEY = (0, import_api2.createContextKey)("autotel-edge-config");
function setConfig(config2) {
  return import_api2.context.active().setValue(CONFIG_KEY, config2);
}
__name(setConfig, "setConfig");
function parseConfig(config2) {
  const headSampler = config2.sampling?.headSampler ?? new ParentBasedSampler({
    root: new AlwaysOnSampler()
  });
  const parsedHeadSampler = typeof headSampler === "object" && "ratio" in headSampler ? createParentRatioSampler(headSampler) : headSampler;
  const tailSampler = config2.sampling?.tailSampler ?? ((traceInfo) => {
    const localRootSpan = traceInfo.localRootSpan;
    const ctx = localRootSpan.spanContext();
    return (ctx.traceFlags & 1) === 1 || localRootSpan.status.code === 2;
  });
  const spanProcessors = isSpanProcessorConfig(config2) ? Array.isArray(config2.spanProcessors) ? config2.spanProcessors : [config2.spanProcessors] : [
    // Use TailSamplingSpanProcessor to enable tail sampling
    new TailSamplingSpanProcessor(
      typeof config2.exporter === "object" && "url" in config2.exporter ? new OTLPExporter(config2.exporter) : config2.exporter,
      config2.postProcessor,
      tailSampler
      // Wire up the tail sampler!
    )
  ];
  const resolved = {
    service: config2.service,
    handlers: {
      fetch: config2.handlers?.fetch ?? {}
    },
    fetch: {
      includeTraceContext: config2.fetch?.includeTraceContext ?? true
    },
    postProcessor: config2.postProcessor ?? ((spans) => spans),
    sampling: {
      headSampler: parsedHeadSampler,
      tailSampler
    },
    spanProcessors,
    propagator: config2.propagator ?? new import_core3.W3CTraceContextPropagator(),
    instrumentation: {
      instrumentGlobalFetch: config2.instrumentation?.instrumentGlobalFetch ?? true,
      instrumentGlobalCache: config2.instrumentation?.instrumentGlobalCache ?? false,
      disabled: config2.instrumentation?.disabled ?? false
    },
    subscribers: config2.subscribers ?? []
  };
  return resolved;
}
__name(parseConfig, "parseConfig");
function createParentRatioSampler(config2) {
  const { ratio, acceptRemote = true } = config2;
  const ratioSampler = {
    shouldSample: /* @__PURE__ */ __name(() => ({
      decision: Math.random() < ratio ? 1 : 0,
      // RECORD_AND_SAMPLED : NOT_RECORD
      attributes: {}
    }), "shouldSample"),
    toString: /* @__PURE__ */ __name(() => `ParentRatioSampler{ratio=${ratio}}`, "toString")
  };
  if (acceptRemote) {
    return new ParentBasedSampler({ root: ratioSampler });
  }
  return ratioSampler;
}
__name(createParentRatioSampler, "createParentRatioSampler");
function createInitialiser(config2) {
  if (typeof config2 === "function") {
    return (env3, trigger) => {
      const conf = parseConfig(config2(env3, trigger));
      return conf;
    };
  } else {
    const parsed = parseConfig(config2);
    return () => parsed;
  }
}
__name(createInitialiser, "createInitialiser");

// ../../packages/autotel-edge/dist/index.js
import { AsyncLocalStorage } from "async_hooks";
import { EventEmitter as EventEmitter2 } from "events";
import { Buffer as Buffer2 } from "buffer";
import { Buffer as Buffer3 } from "buffer";
var idGenerator = new RandomIdGenerator();
globalThis.Buffer = Buffer2;
var TRACE_FACTORY_SYMBOL = Symbol.for("autotel.edge.functional.factory");
var PARAM_TOKEN_SANITIZE_REGEX = new RegExp(String.raw`[{}\[\]\s]`, "g");
var INSTRUMENTED_SYMBOL = Symbol.for("autotel.edge.functional.instrumented");

// ../../packages/autotel-cloudflare/dist/actors.js
function getTracer5() {
  return import_api3.trace.getTracer("autotel-cloudflare-actors");
}
__name(getTracer5, "getTracer5");
function tracedHandler(actorClass, config2) {
  const initialiser = createInitialiser(config2);
  return {
    async fetch(request, env3, _ctx) {
      const telemetryConfig = initialiser(env3, { type: "http" });
      const configContext = setConfig(telemetryConfig);
      const parentContext = import_api3.propagation.extract(configContext, request.headers);
      const tracer = getTracer5();
      const url = new URL(request.url);
      const actorClassName = actorClass.name || "Actor";
      let actorName;
      try {
        if (actorClass.nameFromRequest) {
          actorName = await actorClass.nameFromRequest(request);
        }
      } catch {
        actorName = void 0;
      }
      const spanName = `${actorClassName} handler: ${request.method} ${url.pathname}`;
      return tracer.startActiveSpan(
        spanName,
        {
          kind: import_api3.SpanKind.SERVER,
          attributes: {
            "http.request.method": request.method,
            "url.full": request.url,
            "url.path": url.pathname,
            "url.query": url.search,
            "actor.class": actorClassName,
            ...actorName && { "actor.name": actorName },
            "faas.trigger": "http"
          }
        },
        parentContext,
        async (span) => {
          try {
            const envObj = env3;
            const bindingName = Object.keys(envObj).find((key) => {
              const binding2 = env3.__DURABLE_OBJECT_BINDINGS;
              return key === actorClassName || binding2?.[key]?.class_name === actorClassName;
            });
            if (!bindingName) {
              span.setStatus({
                code: import_api3.SpanStatusCode.ERROR,
                message: `No Durable Object binding found for ${actorClassName}`
              });
              return Response.json(
                {
                  error: "Configuration Error",
                  message: `No Durable Object binding found for actor class ${actorClassName}`
                },
                { status: 500, headers: { "Content-Type": "application/json" } }
              );
            }
            const namespace = envObj[bindingName];
            const idString = actorName || "default";
            const locationHint = actorClass.configuration?.(request)?.locationHint;
            const stub = namespace.getByName(idString, { locationHint });
            if ("setName" in stub && typeof stub.setName === "function") {
              stub.setName(idString);
            }
            const headers = new Headers(request.headers);
            import_api3.propagation.inject(import_api3.context.active(), headers);
            const tracedRequest = new Request(request.url, {
              method: request.method,
              headers,
              body: request.body,
              redirect: request.redirect
            });
            const response = await stub.fetch(tracedRequest);
            span.setAttributes({
              "http.response.status_code": response.status,
              "actor.name": idString
            });
            if (response.ok) {
              span.setStatus({ code: import_api3.SpanStatusCode.OK });
            } else {
              span.setStatus({ code: import_api3.SpanStatusCode.ERROR });
            }
            return response;
          } catch (error3) {
            span.recordException(error3);
            span.setStatus({
              code: import_api3.SpanStatusCode.ERROR,
              message: error3 instanceof Error ? error3.message : String(error3)
            });
            return Response.json(
              {
                error: "Internal Server Error",
                message: error3 instanceof Error ? error3.message : "Unknown error"
              },
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          } finally {
            span.end();
          }
        }
      );
    }
  };
}
__name(tracedHandler, "tracedHandler");

// ../../packages/autotel-edge/dist/sampling.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function createAdaptiveTailSampler(options = {}) {
  const baselineSampleRate = options.baselineSampleRate ?? 0.1;
  const slowThresholdMs = options.slowThresholdMs ?? 1e3;
  const alwaysSampleErrors = options.alwaysSampleErrors ?? true;
  const alwaysSampleSlow = options.alwaysSampleSlow ?? true;
  if (baselineSampleRate < 0 || baselineSampleRate > 1) {
    throw new Error("Baseline sample rate must be between 0 and 1");
  }
  const baselineDecisions = /* @__PURE__ */ new Map();
  return (traceInfo) => {
    const { traceId, localRootSpan } = traceInfo;
    if (!baselineDecisions.has(traceId)) {
      baselineDecisions.set(traceId, Math.random() < baselineSampleRate);
    }
    const baselineDecision = baselineDecisions.get(traceId);
    if (alwaysSampleErrors && localRootSpan.status.code === 2) {
      return true;
    }
    if (alwaysSampleSlow) {
      const duration = getDurationMs(localRootSpan);
      if (duration >= slowThresholdMs) {
        return true;
      }
    }
    return baselineDecision;
  };
}
__name(createAdaptiveTailSampler, "createAdaptiveTailSampler");
function createErrorOnlyTailSampler() {
  return (traceInfo) => {
    return traceInfo.localRootSpan.status.code === 2;
  };
}
__name(createErrorOnlyTailSampler, "createErrorOnlyTailSampler");
function getDurationMs(span) {
  const start = span.startTime[0] * 1e3 + span.startTime[1] / 1e6;
  const end = span.endTime[0] * 1e3 + span.endTime[1] / 1e6;
  return end - start;
}
__name(getDurationMs, "getDurationMs");
var SamplingPresets = {
  /**
   * Production: 10% baseline, all errors, all slow (>1s)
   * Recommended for most production workloads
   */
  production: /* @__PURE__ */ __name(() => createAdaptiveTailSampler({
    baselineSampleRate: 0.1,
    slowThresholdMs: 1e3
  }), "production"),
  /**
   * High-traffic: 1% baseline, all errors, all slow (>2s)
   * For high-volume services where cost is a concern
   */
  highTraffic: /* @__PURE__ */ __name(() => createAdaptiveTailSampler({
    baselineSampleRate: 0.01,
    slowThresholdMs: 2e3
  }), "highTraffic"),
  /**
   * Debugging: All errors, all slow (>500ms), 50% baseline
   * For active debugging sessions
   */
  debugging: /* @__PURE__ */ __name(() => createAdaptiveTailSampler({
    baselineSampleRate: 0.5,
    slowThresholdMs: 500
  }), "debugging"),
  /**
   * Development: 100% sampling
   * For local development and testing
   */
  development: /* @__PURE__ */ __name(() => () => true, "development"),
  /**
   * Errors only: Capture all failures, drop all successes
   * For error-focused monitoring
   */
  errorsOnly: /* @__PURE__ */ __name(() => createErrorOnlyTailSampler(), "errorsOnly")
};

// src/actor.ts
var CounterActor = class extends Actor {
  static {
    __name(this, "CounterActor");
  }
  // Persistent property - automatically persisted between requests
  // Note: The exact API may vary - this is a simplified example
  countValue = 0;
  /**
   * onInit is automatically traced with 'actor.lifecycle': 'init'
   */
  async onInit() {
    console.log("CounterActor initialized");
    try {
      if (this.alarms && typeof this.alarms.set === "function") {
        await this.alarms.set({
          scheduledTime: Date.now() + 6e4
          // 1 minute from now
        });
      }
    } catch (error3) {
      console.warn("Could not set alarm:", error3);
    }
  }
  /**
   * onRequest is automatically traced with full HTTP semantics
   * All storage operations within are also automatically traced
   */
  async onRequest(request) {
    const url = new URL(request.url);
    const method = request.method;
    if (method === "GET" && url.pathname === "/") {
      return Response.json({
        count: this.countValue,
        message: "Hello from CounterActor!"
      });
    }
    if (method === "POST" && url.pathname === "/increment") {
      const body = await request.json().catch(() => ({}));
      const amount = body.amount ?? 1;
      this.countValue += amount;
      return Response.json({
        count: this.countValue,
        incremented: amount
      });
    }
    if (method === "POST" && url.pathname === "/reset") {
      this.countValue = 0;
      return Response.json({
        count: 0,
        message: "Counter reset"
      });
    }
    if (method === "GET" && url.pathname === "/storage") {
      try {
        if (this.storage && typeof this.storage.exec === "function") {
          await this.storage.exec(`
            CREATE TABLE IF NOT EXISTS visits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL
            )
          `);
          await this.storage.exec(
            `INSERT INTO visits (timestamp) VALUES (?)`,
            [(/* @__PURE__ */ new Date()).toISOString()]
          );
          const visits = await this.storage.prepare(
            "SELECT * FROM visits ORDER BY timestamp DESC LIMIT 10"
          ).all();
          return Response.json({
            visits: visits.results || [],
            total: visits.results?.length || 0
          });
        }
      } catch (error3) {
        return Response.json({
          error: "Storage not available",
          message: error3 instanceof Error ? error3.message : String(error3)
        }, { status: 500 });
      }
    }
    if (method === "GET" && url.pathname === "/alarms") {
      try {
        if (this.alarms && typeof this.alarms.set === "function") {
          await this.alarms.set({
            scheduledTime: Date.now() + 5e3,
            data: { message: "Custom alarm triggered!" }
          });
          return Response.json({
            message: "Alarm scheduled for 5 seconds from now",
            scheduledTime: new Date(Date.now() + 5e3).toISOString()
          });
        }
      } catch (error3) {
        return Response.json({
          error: "Alarms not available",
          message: error3 instanceof Error ? error3.message : String(error3)
        }, { status: 500 });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
  /**
   * onAlarm is automatically traced with 'actor.lifecycle': 'alarm'
   * This is called when an alarm is triggered
   */
  async onAlarm(alarmInfo) {
    console.log("Alarm triggered", { alarmInfo, count: this.countValue });
    this.countValue += 1;
    try {
      if (this.alarms && typeof this.alarms.set === "function") {
        await this.alarms.set({
          scheduledTime: Date.now() + 6e4
          // 1 minute from now
        });
      }
    } catch (error3) {
      console.warn("Could not set alarm:", error3);
    }
  }
  /**
   * Static method to extract actor name from request
   * This is used by tracedHandler to identify the actor instance
   */
  static async nameFromRequest(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || url.pathname.split("/").pop();
    return name || "default";
  }
};
var actor_default = tracedHandler(CounterActor, (env3) => ({
  exporter: {
    url: env3.OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
    headers: env3.OTLP_HEADERS ? JSON.parse(env3.OTLP_HEADERS) : {}
  },
  service: {
    name: "counter-actor-service",
    version: "1.0.0"
  },
  // Adaptive sampling: 10% baseline, all errors, all slow requests (>1s)
  sampling: {
    tailSampler: env3.ENVIRONMENT === "production" ? SamplingPresets.production() : SamplingPresets.development()
    // 100% in dev
  },
  // Actor-specific instrumentation options
  actors: {
    instrumentStorage: true,
    // Trace SQL queries
    instrumentAlarms: true,
    // Trace alarm operations
    instrumentSockets: true,
    // Trace WebSocket operations
    capturePersistEvents: true
    // Trace property persistence
  }
}));

// src/actor-worker.ts
var actor_worker_default = actor_default;
var handler = actor_default;
export {
  CounterActor,
  actor_worker_default as default,
  handler
};
//# sourceMappingURL=actor-worker.js.map
