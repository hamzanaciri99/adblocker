// Stub for FuckAdBlock / BlockAdBlock.
//
// The library's whole purpose is to fire a "detected" callback. This replacement
// keeps the API and always takes the "not detected" branch, so the page runs the
// code path it would run for a visitor with no blocker at all.
(function () {
  'use strict';
  const w = window;

  function Detector() {
    this._options = { checkOnLoad: false, resetOnEnd: false };
    this._callbacks = { detected: [], notDetected: [] };
  }

  Detector.prototype.setOption = function (key, value) {
    if (typeof key === 'object') Object.assign(this._options, key);
    else this._options[key] = value;
    return this;
  };
  Detector.prototype.on = function (detected, fn) {
    if (detected === false || detected === 'notDetected') this._callbacks.notDetected.push(fn);
    else this._callbacks.detected.push(fn);
    return this;
  };
  Detector.prototype.onDetected = function (fn) { return this.on(true, fn); };
  Detector.prototype.onNotDetected = function (fn) {
    this._callbacks.notDetected.push(fn);
    setTimeout(function () { try { fn(); } catch (ignored) { /* publisher code */ } }, 1);
    return this;
  };
  Detector.prototype.emitEvent = function () {
    for (const fn of this._callbacks.notDetected) {
      try { fn(); } catch (ignored) { /* publisher code */ }
    }
    return this;
  };
  Detector.prototype.clearEvent = function () { return this; };
  Detector.prototype.check = function () { this.emitEvent(); return true; };

  w.FuckAdBlock = Detector;
  w.BlockAdBlock = Detector;
  w.fuckAdBlock = new Detector();
  w.blockAdBlock = new Detector();
})();
