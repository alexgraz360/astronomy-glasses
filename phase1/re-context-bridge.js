/* ================== Reality Engine context bridge ==================
   Publishes a compact "what the user is looking at" message to the
   Reality Engine shell when (and ONLY when) this app is embedded by it.
   Standalone use: complete no-op — no listeners fire, nothing is posted,
   nothing about the app changes.

   ADDITIVE ONLY (same spirit as the H18 Events block): reads existing
   globals (SimClock, RE.getObserver, Astronomy) and lazily wraps
   window.RE_openDashboard to observe selection. It never touches the
   frozen H16 look/tap/pan layer and adds nothing to the canvas.

   Message OUT (targeted origin, never '*'):
     { type: 'RE_ASTRO_CONTEXT',
       selected: { name, kind, altitudeDeg, azimuthDeg, magnitude } | null,
       simTimeISO, location: { lat, lon } | null,   // rounded to 2 dp
       visibleBright: [names] }
   Message IN: { type: 'RE_ASTRO_REQUEST' } → replies with the latest context.
*/
(function () {
  var SHELL_ORIGIN = "https://alexgraz360.github.io";
  var PUBLISH_MS = 4000;

  window.RE_bridgeDebug = { active: false }; // visible in both modes for tests

  // Activate only when embedded by the shell. document.referrer is the
  // embedding page for a fresh iframe; combined with targeted postMessage
  // (which the browser only delivers to SHELL_ORIGIN) this is belt-and-braces.
  var embedded = false;
  try { embedded = window.parent !== window; } catch (e) { embedded = false; }
  var refOk = false;
  try { refOk = document.referrer.indexOf(SHELL_ORIGIN + "/") === 0; } catch (e) {}
  if (!embedded || !refOk) return; // standalone: NO-OP

  window.RE_bridgeDebug.active = true;

  var BODIES = ["Moon", "Venus", "Jupiter", "Saturn", "Mars", "Mercury", "Sun"];
  var KIND = { Sun: "star (our Sun)", Moon: "Earth's moon", Mercury: "planet", Venus: "planet",
               Mars: "planet", Jupiter: "planet", Saturn: "planet" };
  var selectedName = null;

  // Observe selection by wrapping the app's own open-dashboard entry point.
  // It is defined by a deferred module script, so wrap after load.
  function wrapSelection() {
    var orig = window.RE_openDashboard;
    if (typeof orig !== "function") { setTimeout(wrapSelection, 500); return; }
    window.RE_openDashboard = function (name) {
      selectedName = name;
      publish();
      return orig.apply(this, arguments);
    };
  }
  if (document.readyState === "complete") wrapSelection();
  else window.addEventListener("load", wrapSelection);

  function bodyNow(name, time, obs) {
    var eq = Astronomy.Equator(name, time, obs, true, true);
    var hor = Astronomy.Horizon(time, obs, eq.ra, eq.dec, "normal");
    var mag = null;
    try { mag = Astronomy.Illumination(name, time).mag; } catch (e) {}
    return { alt: hor.altitude, az: hor.azimuth, mag: mag };
  }

  function buildContext() {
    var obs = (window.RE && RE.getObserver) ? RE.getObserver() : null;
    var simDate = SimClock.now();
    var msg = {
      type: "RE_ASTRO_CONTEXT",
      selected: null,
      simTimeISO: simDate.toISOString(),
      location: obs ? { lat: Math.round(obs.latitude * 100) / 100,
                        lon: Math.round(obs.longitude * 100) / 100 } : null,
      visibleBright: []
    };
    if (!obs) return msg;
    var time = Astronomy.MakeTime(simDate);
    // Dashboard closed again? RE.isARPaused() false means no dashboard/space view.
    if (selectedName && window.RE && RE.isARPaused && !RE.isARPaused()) selectedName = null;
    BODIES.forEach(function (name) {
      try {
        var b = bodyNow(name, time, obs);
        if (b.alt > 3 && name !== "Sun") msg.visibleBright.push(name);
        if (name === selectedName) {
          msg.selected = { name: name, kind: KIND[name] || "object",
            altitudeDeg: Math.round(b.alt), azimuthDeg: Math.round(b.az),
            magnitude: b.mag === null ? null : Math.round(b.mag * 10) / 10 };
        }
      } catch (e) { /* per-body failure never breaks the message */ }
    });
    // Selected body below the app's default horizon filter still counts —
    // build its entry even if it wasn't added above (e.g. Sun, or alt < 3).
    if (selectedName && !msg.selected) {
      try {
        var s = bodyNow(selectedName, time, obs);
        msg.selected = { name: selectedName, kind: KIND[selectedName] || "object",
          altitudeDeg: Math.round(s.alt), azimuthDeg: Math.round(s.az),
          magnitude: s.mag === null ? null : Math.round(s.mag * 10) / 10 };
      } catch (e) {}
    }
    return msg;
  }

  function publish() {
    try {
      window.parent.postMessage(buildContext(), SHELL_ORIGIN); // targeted, never '*'
    } catch (e) { /* never surface bridge errors into the app */ }
  }

  // Reply to shell pull requests — origin-validated.
  window.addEventListener("message", function (e) {
    if (e.origin !== SHELL_ORIGIN) return;
    if (e.data && e.data.type === "RE_ASTRO_REQUEST") publish();
  });

  setInterval(publish, PUBLISH_MS); // light throttle; postMessage is cheap
  publish();
})();
