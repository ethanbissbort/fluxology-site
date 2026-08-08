<script>
  import { onMount } from 'svelte';

  // Layered cursor: a precise dot at the pointer plus a themed ring that
  // trails it (lerped), grows over interactive elements, and pulses on
  // click. The ring/dot colors track --current-accent-primary, so the
  // cursor re-themes as you scroll between sections.
  //
  // Enabled only for fine pointers with hover capability, and never under
  // prefers-reduced-motion. Touch devices and keyboard users are unaffected.
  //
  // IMPORTANT: visibility/hover/pulse states are driven by reactive `class:`
  // directives, NOT runtime classList mutation — Svelte prunes scoped CSS
  // selectors it cannot see in the template, so classList-only classes end
  // up with their style rules stripped from the build (which made the
  // cursor permanently invisible in the first version of this component).

  let enabled = $state(false);
  let shown = $state(false);
  let hovering = $state(false);
  let pulsing = $state(false);
  let dotEl = $state(null);
  let ringEl = $state(null);

  onMount(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let raf = null;
    let nativeCursorHidden = false;

    function startLoop() {
      if (raf === null) raf = requestAnimationFrame(loop);
    }

    function stopLoop() {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    function hideNativeCursor() {
      // Deferred to the first pointer movement on purpose: the replacement
      // layers only reach opacity 1 via `shown`, which is also set here, so
      // adding the class at start() left desktop visitors with NO cursor at
      // all — native hidden, replacement still transparent — until they
      // happened to move the mouse.
      if (!nativeCursorHidden) {
        nativeCursorHidden = true;
        document.documentElement.classList.add('cursor-fx');
      }
    }

    function onMove(e) {
      x = e.clientX;
      y = e.clientY;
      shown = true;
      hideNativeCursor();
      startLoop();
      // Grow the ring over anything interactive.
      hovering = !!e.target?.closest?.(
        'a, button, [role="button"], input, textarea, select, label, summary'
      );
    }

    function onLeave() {
      shown = false;
      // The opacity transition hides the layers, so stop lerping an
      // invisible cursor instead of re-queueing rAF forever.
      stopLoop();
    }

    function onDown() {
      // Drop the class for one frame so rapid clicks restart the animation.
      pulsing = false;
      requestAnimationFrame(() => {
        pulsing = true;
      });
    }

    function loop() {
      ringX += (x - ringX) * 0.16;
      ringY += (y - ringY) * 0.16;

      // Settle and stop once the ring has caught the pointer. Without this the
      // loop re-queued itself at 60fps for as long as the tab stayed focused,
      // writing two identical transforms per frame after the pointer had been
      // stationary for minutes. onMove's startLoop() restarts it.
      if (Math.abs(x - ringX) < 0.1 && Math.abs(y - ringY) < 0.1) {
        ringX = x;
        ringY = y;
        raf = null;
      }

      if (dotEl) dotEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (ringEl) ringEl.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;

      if (raf !== null) raf = requestAnimationFrame(loop);
    }

    function start() {
      if (enabled) return;
      enabled = true;
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerdown', onDown, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
      // The rAF loop starts on the first pointermove (see startLoop), so an
      // idle page never lerps invisible layers; loop() stops it again once the
      // ring converges. The native cursor is only hidden once the replacement
      // is actually painted (see hideNativeCursor).
    }

    function stop() {
      if (!enabled) return;
      enabled = false;
      shown = false;
      hovering = false;
      pulsing = false;
      stopLoop();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      nativeCursorHidden = false;
      document.documentElement.classList.remove('cursor-fx');
    }

    // Track both media queries live: enabling OS reduce-motion mid-session
    // must tear the cursor down without a reload, and a convertible device
    // switching from touch to mouse mode should gain the effect.
    function update() {
      if (finePointer.matches && !reducedMotion.matches) {
        start();
      } else {
        stop();
      }
    }

    finePointer.addEventListener('change', update);
    reducedMotion.addEventListener('change', update);
    update();

    return () => {
      finePointer.removeEventListener('change', update);
      reducedMotion.removeEventListener('change', update);
      stop();
    };
  });
</script>

{#if enabled}
  <div class="cursor-dot" class:on={shown} bind:this={dotEl} aria-hidden="true"></div>
  <div
    class="cursor-ring"
    class:on={shown}
    class:hover={hovering}
    class:pulse={pulsing}
    bind:this={ringEl}
    onanimationend={() => (pulsing = false)}
    aria-hidden="true"
  ></div>
{/if}

<style>
  /* Hide the native cursor while the effect is active — but never over text
     fields, where the I-beam caret matters for usability. */
  :global(html.cursor-fx),
  :global(html.cursor-fx *) {
    cursor: none;
  }

  :global(html.cursor-fx input),
  :global(html.cursor-fx textarea) {
    cursor: text;
  }

  .cursor-dot {
    position: fixed;
    top: 0;
    left: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--current-accent-primary, #3a86ff);
    pointer-events: none;
    z-index: 10000;
    opacity: 0;
    transition:
      opacity 0.25s ease-out,
      background-color var(--transition-theme, 0.6s) ease;
  }

  .cursor-ring {
    position: fixed;
    top: 0;
    left: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--current-accent-primary, #3a86ff);
    pointer-events: none;
    z-index: 9999;
    opacity: 0;
    transition:
      opacity 0.25s ease-out,
      width 0.25s ease-out,
      height 0.25s ease-out,
      background-color 0.25s ease-out,
      border-color var(--transition-theme, 0.6s) ease;
  }

  .cursor-dot.on,
  .cursor-ring.on {
    opacity: 1;
  }

  .cursor-ring.hover {
    width: 54px;
    height: 54px;
    background: color-mix(in srgb, var(--current-accent-primary, #3a86ff) 15%, transparent);
  }

  .cursor-ring.pulse {
    animation: cursor-pulse 0.45s ease-out;
  }

  @keyframes cursor-pulse {
    from {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--current-accent-primary, #3a86ff) 45%, transparent);
    }
    to {
      box-shadow: 0 0 0 20px transparent;
    }
  }
</style>
