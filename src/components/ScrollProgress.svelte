<script>
  import { onMount } from 'svelte';

  let progress = $state(0);

  function updateProgress() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    const scrollable = documentHeight - windowHeight;
    // Guard against division by zero (content shorter than the viewport) and
    // clamp: overscroll/bounce can push the raw ratio outside 0–100.
    progress = scrollable > 0 ? Math.min(100, Math.max(0, (scrollTop / scrollable) * 100)) : 0;
  }

  onMount(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateProgress();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Viewport resizes change the scrollable height, so recalculate.
    window.addEventListener('resize', handleScroll, { passive: true });
    updateProgress();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  });
</script>

<div
  class="scroll-progress"
  role="progressbar"
  aria-label="Page scroll progress"
  aria-valuenow={Math.round(progress)}
  aria-valuemin="0"
  aria-valuemax="100"
>
  <div class="scroll-progress-bar" style="width: {progress}%"></div>
</div>

<style>
  .scroll-progress {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    /* One above the nav — at equal z-index the nav (later in the DOM)
       painted over the bar. */
    z-index: calc(var(--z-navigation) + 1);
    pointer-events: none;
  }

  .scroll-progress-bar {
    height: 100%;
    background: var(--current-accent-primary, #3A86FF);
    transition: width 0.1s linear, background-color var(--transition-theme) var(--ease-in-out-cubic);
  }

  @media (max-width: 767px) {
    .scroll-progress {
      height: 2px;
    }
  }
</style>
