<script>
  import { onMount } from 'svelte';

  // Note: anchor scrolling is intentionally native. reset.css sets
  // `html { scroll-behavior: smooth }` (with prefers-reduced-motion
  // overrides) and base.css sets scroll-margin-top for the fixed nav, so
  // there is no JS scroll interception here. The previous implementation
  // intercepted every a[href^="#"] — which broke the skip link (it
  // preventDefault-ed without moving focus), ignored reduced-motion, and
  // mis-measured offsets under content-visibility:auto.

  onMount(() => {
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    if (!navToggle || !navLinks) return;

    function closeMenu() {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }

    function toggleMenu() {
      const isOpen = navLinks.classList.contains('open');

      if (isOpen) {
        closeMenu();
      } else {
        navLinks.classList.add('open');
        navToggle.setAttribute('aria-expanded', 'true');
      }
    }

    // Close menu when clicking a link
    function onLinkClick() {
      closeMenu();
    }

    // Close menu when clicking outside
    function onDocumentClick(e) {
      if (
        !navToggle.contains(e.target) &&
        !navLinks.contains(e.target) &&
        navLinks.classList.contains('open')
      ) {
        closeMenu();
      }
    }

    // Close menu on Escape key, returning focus to the toggle
    function onDocumentKeydown(e) {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        closeMenu();
        navToggle.focus();
      }
    }

    navToggle.addEventListener('click', toggleMenu);

    const links = navLinks.querySelectorAll('.nav-link');
    links.forEach((link) => link.addEventListener('click', onLinkClick));

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);

    return () => {
      navToggle.removeEventListener('click', toggleMenu);
      links.forEach((link) => link.removeEventListener('click', onLinkClick));
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeydown);
    };
  });
</script>

<!-- This component has no visual output, it just manages navigation interactions -->
