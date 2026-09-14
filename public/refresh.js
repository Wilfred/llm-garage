(() => {
  let content = document.querySelector("main[data-refresh-seconds]");
  if (!content) return;

  const scheduleRefresh = () => {
    const seconds = Number(content.dataset.refreshSeconds);
    if (seconds > 0) window.setTimeout(refresh, seconds * 1000);
  };

  const refresh = async () => {
    try {
      const response = await window.fetch(window.location.href, {
        cache: "no-store",
      });
      if (!response.ok) return;

      const nextDocument = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const nextContent = nextDocument.querySelector("main");
      if (!nextContent) return;

      const expandedDetails = new Set(
        Array.from(
          content.querySelectorAll("details.turn-details[open]"),
          (details) => details.dataset.refreshKey,
        ),
      );
      nextContent
        .querySelectorAll("details.turn-details[data-refresh-key]")
        .forEach((details) => {
          if (expandedDetails.has(details.dataset.refreshKey)) {
            details.open = true;
          }
        });

      content.replaceWith(nextContent);
      content = nextContent;
    } catch {
      // A later poll can recover from a transient request or parsing failure.
    } finally {
      scheduleRefresh();
    }
  };

  scheduleRefresh();
})();
