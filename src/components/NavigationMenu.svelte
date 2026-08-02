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

    const isOpen = () => navLinks.classList.contains('open');

    function closeMenu() {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }

    // Move focus into the opened overlay. The panel transitions from
    // visibility:hidden, so a same-tick focus() lands while it is still
    // unfocusable — retry across a few frames until the focus sticks.
    function focusFirstLink(attempt = 0) {
      const first = navLinks.querySelector('.nav-link');
      if (!first || !isOpen()) return;
      first.focus();
      if (document.activeElement !== first && attempt < 5) {
        requestAnimationFrame(() => focusFirstLink(attempt + 1));
      }
    }

    function openMenu() {
      navLinks.classList.add('open');
      navToggle.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => focusFirstLink());
    }

    function toggleMenu() {
      if (isOpen()) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    // Close menu when clicking a link. For in-page anchors, park focus back
    // on the toggle (preventScroll so the anchor scroll is not hijacked)
    // instead of stranding it on a link inside the now-hidden panel.
    function onLinkClick(e) {
      const wasOpen = isOpen();
      closeMenu();
      if (wasOpen && e.currentTarget.getAttribute('href')?.startsWith('#')) {
        navToggle.focus({ preventScroll: true });
      }
    }

    // Close menu when clicking outside
    function onDocumentClick(e) {
      if (
        !navToggle.contains(e.target) &&
        !navLinks.contains(e.target) &&
        isOpen()
      ) {
        closeMenu();
        // Reclaim focus only when the click itself focused nothing (e.g.
        // tapping page background), so focus is never stranded inside the
        // hidden panel but is also never stolen from a clicked control.
        const active = document.activeElement;
        if (!active || active === document.body || navLinks.contains(active)) {
          navToggle.focus({ preventScroll: true });
        }
      }
    }

    // While open: Escape closes and restores focus to the toggle; Tab is
    // trapped within toggle + menu links so keyboard focus cannot reach the
    // content hidden behind the fixed overlay.
    function onDocumentKeydown(e) {
      if (!isOpen()) return;

      if (e.key === 'Escape') {
        closeMenu();
        navToggle.focus();
        return;
      }

      if (e.key === 'Tab') {
        // Only trap while the collapsed overlay is actually in effect (the
        // toggle is display:none on wide viewports where the menu is inline).
        if (getComputedStyle(navToggle).display === 'none') return;

        const focusables = [navToggle, ...navLinks.querySelectorAll('.nav-link')];
        const index = focusables.indexOf(document.activeElement);
        let next;
        if (index === -1) {
          next = focusables[0];
        } else if (e.shiftKey) {
          next = focusables[(index - 1 + focusables.length) % focusables.length];
        } else {
          next = focusables[(index + 1) % focusables.length];
        }
        e.preventDefault();
        next.focus();
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
