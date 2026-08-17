/* =============================================================================
   Fluxology dashboard — colour mode + icon bootstrap
   -----------------------------------------------------------------------------
   SYNCED COPY, byte-identical across public/jobs, public/deals and
   public/office-scout. Verify with:

       node tools/check-dashboard-ds.mjs

   Deliberately separate from each dashboard's app.js: the feed, filter, sort and
   workspace logic in those files is untouched by the design-system work, and
   keeping the theme code out of them means a change here can never regress it.

   Dark is the brand default. An explicit choice is remembered per browser; with
   no stored choice the OS preference wins and keeps tracking it.
   ============================================================================= */

(function () {
  'use strict';

  var STORAGE_KEY = 'fluxology.dashboard.mode';
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null; // private mode / blocked storage: fall through to the OS
    }
  }

  function systemMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function apply(mode) {
    root.setAttribute('data-mode', mode);
    // Keep the browser chrome (mobile address bar) in step with the page.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#F7F3E9' : '#0B1520');
    var btn = document.querySelector('.mode-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(mode === 'light'));
      btn.setAttribute(
        'title',
        mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
      );
    }
  }

  // Applied at parse time (this file is loaded in <head>) so the first paint is
  // already in the right mode and there is no light flash on a dark dashboard.
  apply(stored() || systemMode());

  // Track the OS only while the user has expressed no preference of their own.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (!stored()) apply(systemMode()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var btn = document.querySelector('.mode-toggle');
    if (btn) {
      apply(root.getAttribute('data-mode') || 'dark');
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-mode') === 'light' ? 'dark' : 'light';
        apply(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch (e) {
          /* Storage blocked — the mode still applies for this page view. */
        }
      });
    }

    // Lucide is the system's approved icon set, loaded from its CDN. Every glyph
    // here is decorative and sits beside a real text label, so a blocked or slow
    // CDN costs appearance only — never a control the operator needs.
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons();
      } catch (e) {
        /* no-op: labels carry the meaning */
      }
    }
  });
})();
