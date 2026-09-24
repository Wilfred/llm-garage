(() => {
  const transcriptBlob = async (url) => {
    const response = await window.fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Transcript request failed");
    return new Blob([await response.text()], { type: "text/plain" });
  };

  const copy = async (url) => {
    // Handing ClipboardItem a promise keeps the write inside the click's user
    // activation while the transcript downloads, which Safari requires.
    if (window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": transcriptBlob(url) }),
      ]);
    } else {
      await navigator.clipboard.writeText(
        await (await transcriptBlob(url)).text(),
      );
    }
  };

  // Delegated so buttons survive the page refresh replacing <main>.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[data-copy-transcript]");
    // Without the clipboard API (such as over plain HTTP), the link opens the
    // transcript instead.
    if (!link || !navigator.clipboard) return;
    event.preventDefault();

    link.dataset.label ??= link.textContent;
    const show = (text) => {
      link.textContent = text;
      window.setTimeout(() => {
        link.textContent = link.dataset.label;
      }, 2000);
    };
    copy(link.href).then(
      () => show("Copied"),
      () => show("Copy failed"),
    );
  });
})();
