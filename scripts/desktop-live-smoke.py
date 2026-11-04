#!/usr/bin/env python3
"""Opt-in mock DoIP -> real CLI/relay -> Wails -> WebKit/Plotly acceptance run.

See docs/live-data-soak-test.md for prerequisites and commands. All relay data
and credentials are local test fixtures; no vehicle or deployed relay is used.
"""
import argparse
import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--desktop-url", default="http://127.0.0.1:34116")
parser.add_argument("--relay-bin", default="/tmp/freebeamer-relay-4b")
parser.add_argument("--session-bin", default="/tmp/freebeamer-relay-session")
parser.add_argument("--cli-bin", default="/tmp/freebeamer-4b")
parser.add_argument("--screenshot", default="/tmp/freebeamer-live-view.png")
args = parser.parse_args()


def exact(conn, length):
    data = b""
    while len(data) < length:
        part = conn.recv(length - len(data))
        if not part:
            raise EOFError()
        data += part
    return data


def serve_adapter(listener, counters):
    """The same minimal exchange as cmd/freebeamer/doip_fixture_test.go."""
    try:
        conn, _ = listener.accept()
        with conn:
            def read():
                header = exact(conn, 8)
                return exact(conn, struct.unpack(">I", header[4:])[0])

            def write(kind, body):
                conn.sendall(struct.pack(">BBHI", 2, 253, kind, len(body)) + body)

            read()
            write(6, bytes.fromhex("0e0012341000000000"))
            while True:
                request = read()
                body = bytearray(36)
                struct.pack_into("<Hh", body, 0, 2500, -500)
                write(0x8001, request[2:4] + request[0:2] + b"\x6c\x88" + body)
                counters["replies"] += 1
    except (EOFError, OSError):
        pass


def stop_process(process):
    if process.poll() is None:
        process.send_signal(signal.SIGINT)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def run(folder):
    # Mint a device session directly in the relay DB (static client keys were
    # replaced by Ed25519 device pairing); the CLI sends this as its Bearer
    # token via --api-key.
    key = subprocess.check_output([
        args.session_bin, "--db", folder + "/relay.sqlite", "--token", "smoke-device-session-token"
    ], text=True).strip()
    with socket.socket() as reserve:
        reserve.bind(("127.0.0.1", 0))
        relay_port = reserve.getsockname()[1]
    relay_url = f"http://127.0.0.1:{relay_port}"
    relay_log = open(folder + "/relay.log", "w")
    cli_log = open(folder + "/cli.log", "w")
    relay = subprocess.Popen([
        args.relay_bin, "serve", "--addr", f"127.0.0.1:{relay_port}",
        "--db", folder + "/relay.sqlite", "--admin-token", "local-smoke-token"
    ], stdout=relay_log, stderr=relay_log)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    counters = {"replies": 0}
    threading.Thread(target=serve_adapter, args=(listener, counters), daemon=True).start()
    time.sleep(.3)
    cli = subprocess.Popen([
        args.cli_bin, "mhd", "monitor", "--device-id", "mock-doip-cli", "--count", "4000",
        "--interval", "20ms", "--buffer-file", folder + "/spool.jsonl",
        "--upload-endpoint", relay_url + "/v1/telemetry",
        "--api-key", key, f"127.0.0.1:{listener.getsockname()[1]}"
    ], stdout=subprocess.DEVNULL, stderr=cli_log)
    view = WebKit2.WebView()
    view.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
    window = Gtk.Window()
    window.set_default_size(1440, 1000)
    window.add(view)
    window.show_all()
    started = time.monotonic()
    result = {}
    resources = []
    script = r"""(async () => {
      const pause = ms => new Promise(r => setTimeout(r, ms));
      const wait = async (fn, ms = 15000) => {
        const start = Date.now();
        while (!fn()) { if (Date.now() - start > ms) throw Error('Timeout: ' + fn); await pause(100); }
      };
      await wait(() => document.querySelector('.view-switch'));
      document.querySelectorAll('.view-switch button')[1].click();
      await wait(() => document.querySelector('app-live-view'));
      const set = (selector, value) => {
        const el = document.querySelector(selector); el.value = value;
        el.dispatchEvent(new Event('input', {bubbles:true}));
      };
      await wait(() => !document.querySelector('app-garage-panel .garage-status').textContent.includes('Connecting'));
      if (!document.querySelector('app-garage-panel form')) document.querySelector('app-garage-panel button').click();
      await wait(() => document.querySelector('app-garage-panel form'));
      set('app-garage-panel input[type=url]', RELAY_URL);
      set('app-garage-panel input[type=password]', 'local-smoke-token');
      await pause(100);
      document.querySelector('app-garage-panel button[type=submit]').click();
      await wait(() => document.querySelector('.connection').textContent.trim() === 'connected');
      const chart = () => document.querySelector('.js-plotly-plot')?.data?.[0];
      await wait(() => chart()?.y?.some(x => x !== null));
      if (document.querySelector('input[type=password]')?.value) throw Error('Token not cleared');
      document.querySelectorAll('.view-switch button')[0].click(); await pause(300);
      document.querySelectorAll('.view-switch button')[1].click();
      await wait(() => chart()?.y?.length > 20);
      // A source selection must not stop the backend read loop.
      document.querySelector('.source-bar select').dispatchEvent(new Event('change', {bubbles:true}));
      await wait(() => document.querySelector('.reading-status')?.textContent.includes('2000 / 2,000'), 75000);
      await pause(3000);
      if (chart().y.length !== 2000 || chart().y.some(x => x !== 2500)) throw Error('Incorrect RPM trace or history cap');
      const rows = [...document.querySelectorAll('.channels tbody tr')];
      if (!rows.some(row => row.textContent.includes('Load') && row.textContent.includes('-5'))) throw Error('Incorrect decoded load');
      window.__smokeResult = {
        state: document.querySelector('.connection').textContent.trim(),
        reading: document.querySelector('.reading-status').textContent,
        points: chart().y.length, rpm: chart().y.at(-1),
        error: document.querySelector('.error')?.textContent ?? null
      };
      if (window.__smokeResult.error) throw Error(window.__smokeResult.error);
    })().catch(e => window.__smokeResult = {error: String(e), body: document.body.innerText});"""
    script = script.replace("RELAY_URL", json.dumps(relay_url))
    injected = False

    def loaded(webview, event):
        nonlocal injected
        if event == WebKit2.LoadEvent.FINISHED and not injected:
            injected = True
            view.evaluate_javascript(script, -1, None, None, None, None, None)

    def got(webview, task, *_):
        try:
            raw = webview.evaluate_javascript_finish(task).to_string()
            if raw == "null":
                return
            result.update(json.loads(raw))
            pixbuf = Gdk.pixbuf_get_from_window(window.get_window(), 0, 0, 1440, 1000)
            pixbuf.savev(args.screenshot, "png", [], [])
        except Exception as error:
            result["error"] = str(error)
        Gtk.main_quit()

    def poll():
        elapsed = time.monotonic() - started
        if elapsed > 100:
            result["error"] = "100-second smoke-test timeout"
            Gtk.main_quit()
            return False
        if int(elapsed) % 10 == 0:
            # Direct subprocesses include the WebKit renderer, CLI and relay.
            usage = subprocess.check_output(["ps", "-eo", "ppid=,rss=,time=,comm="], text=True)
            resources.append({"elapsed": round(elapsed, 1), "processes": [
                line.strip() for line in usage.splitlines() if line.split()[0] == str(os.getpid())
            ]})
            print(json.dumps({"elapsed": round(elapsed, 1), "adapterReplies": counters["replies"]}), flush=True)
        view.evaluate_javascript("JSON.stringify(window.__smokeResult ?? null)", -1, None, None, None, got, None)
        return True

    view.connect("load-changed", loaded)
    view.load_uri(args.desktop_url)
    GLib.timeout_add(1000, poll)
    try:
        Gtk.main()
        # Release the backend subscription before removing the local relay.
        view.evaluate_javascript("window.go.main.App.DisconnectLive()", -1, None, None, None, None, None)
        deadline = time.monotonic() + .3
        while time.monotonic() < deadline:
            GLib.MainContext.default().iteration(False)
            time.sleep(.01)
    finally:
        stop_process(cli)
        stop_process(relay)
        listener.close()
        window.destroy()
        relay_log.close()
        cli_log.close()
    print(json.dumps({"result": result, "adapterReplies": counters["replies"],
                      "elapsed": round(time.monotonic() - started, 2),
                      "resources": resources, "screenshot": args.screenshot}), flush=True)
    return 1 if not result or result.get("error") else 0


with tempfile.TemporaryDirectory(prefix="freebeamer-live-") as temporary:
    raise SystemExit(run(temporary))
