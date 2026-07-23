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
    if (!finePointer.matches || reducedMotion.matches) return;

    enabled = true;
    document.documentElement.classList.add('cursor-fx');

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let ringX = x;
    let ringY = y;
    let raf;

    function onMove(e) {
      x = e.clientX;
      y = e.clientY;
      shown = true;
      // Grow the ring over anything interactive.
      hovering = !!e.target?.closest?.(
        'a, button, [role="button"], input, textarea, select, label, summary'
      );
    }

    function onLeave() {
      shown = false;
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
      if (dotEl) dotEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (ringEl) ringEl.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    }

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.documentElement.classList.remove('cursor-fx');
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
