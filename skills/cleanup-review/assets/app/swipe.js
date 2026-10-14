(() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let busy = false,
    drag = null;
  function reset(card) {
    card.style.transform = "";
    card.classList.remove("dragging");
    const stamp = card.querySelector(".swipe-stamp");
    if (stamp) stamp.style.opacity = 0;
    drag = null;
  }
  window.CleanupSwipe = {
    get busy() {
      return busy;
    },
    async choose(value, commit) {
      if (busy) return;
      busy = true;
      const card = document.querySelector(".swipe-card");
      try {
        if (card) {
          card.querySelectorAll("button").forEach((b) => (b.disabled = true));
          const stamp = card.querySelector(".swipe-stamp");
          stamp.textContent = {
            keep: "KEEP",
            shortlist: "SHORTLIST",
            investigate: "LATER",
            dependenciesOnly: "DEPENDENCIES ONLY",
          }[value];
          stamp.dataset.side = value === "keep" ? "left" : "right";
          stamp.style.opacity = 1;
          if (!reduced()) {
            const direction = value === "keep" ? -1 : 1;
            const end =
              value === "investigate"
                ? "translateY(-90px) scale(.92)"
                : value === "dependenciesOnly"
                  ? "translateY(90px) scale(.92)"
                  : `translateX(${direction * Math.max(innerWidth, 800)}px) rotate(${direction * 22}deg)`;
            await card.animate(
              [
                { transform: card.style.transform || "none", opacity: 1 },
                { transform: end, opacity: 0 },
              ],
              {
                duration: 280,
                easing: "cubic-bezier(.4,0,.8,.4)",
                fill: "forwards",
              },
            ).finished;
          }
        }
        commit();
      } finally {
        busy = false;
        drag = null;
      }
    },
  };
  function attach() {
    const card = document.querySelector(".swipe-card");
    if (!card || card.dataset.wired) return;
    card.dataset.wired = "true";
    if (!reduced())
      card.animate(
        [
          { opacity: 0, transform: "translateY(18px) scale(.97)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 350, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    card.addEventListener("pointerdown", (e) => {
      if (
        busy ||
        e.button !== 0 ||
        e.target.closest("button,a,input,textarea,summary,details,.evidence,.dependency-paths")
      )
        return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
    });
    card.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!card.classList.contains("dragging")) {
        if (Math.abs(dy) > 15 && Math.abs(dy) > Math.abs(dx)) {
          drag = null;
          return;
        }
        if (Math.abs(dx) < 12) return;
        card.setPointerCapture(e.pointerId);
        card.classList.add("dragging");
      }
      drag.dx = dx;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
      const stamp = card.querySelector(".swipe-stamp");
      stamp.textContent = dx < 0 ? "KEEP" : "SHORTLIST";
      stamp.dataset.side = dx < 0 ? "left" : "right";
      stamp.style.opacity = Math.min(Math.abs(dx) / 100, 1);
    });
    card.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = drag.dx;
      if (Math.abs(dx) > Math.min(120, card.clientWidth * 0.28)) {
        drag = null;
        window.CleanupReview.choose(dx < 0 ? "keep" : "shortlist");
      } else {
        if (!reduced())
          card.animate([{ transform: card.style.transform }, { transform: "none" }], {
            duration: 220,
            easing: "ease-out",
          });
        reset(card);
      }
    });
    card.addEventListener("pointercancel", () => reset(card));
    card.addEventListener("keydown", (e) => {
      if (e.target !== card || busy) return;
      const value = {
        ArrowLeft: "keep",
        ArrowRight: "shortlist",
        ArrowUp: "investigate",
      }[e.key];
      if (value) {
        e.preventDefault();
        window.CleanupReview.choose(value);
      }
    });
  }
  document.addEventListener("cleanup:item", () => queueMicrotask(attach));
  attach();
})();
