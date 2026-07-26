/* GardenOS destructive-confirm helper. Wraps SweetAlert2 in a single
 * Promise-based API used by every destructive action. Provides a styled
 * dialog that names the item, warns about knock-on effects where they
 * exist, makes Cancel the default focus, and treats Escape as Cancel. */
(function () {
  "use strict";

  function ensureSwal() {
    if (typeof window.Sweetalert2 === "undefined") {
      throw new Error("SweetAlert2 not loaded");
    }
    return window.Sweetalert2;
  }

  function pick(opts, key, fallback) {
    return (opts && typeof opts[key] === "string" && opts[key].trim().length > 0)
      ? opts[key]
      : fallback;
  }

  async function destructive(opts) {
    const Swal = ensureSwal();
    const title = pick(opts, "title", "Are you sure?");
    const itemName = pick(opts, "itemName", "this item");
    const warning = pick(opts, "warning", "This action cannot be undone.");
    const confirmLabel = pick(opts, "confirmLabel", "Yes, delete");
    const cancelLabel = pick(opts, "cancelLabel", "Cancel");
    const body = pick(opts, "body", "");

    const html = [
      `<div class="garden-confirm">`,
      `<div class="garden-confirm__item">${escapeHtml(itemName)}</div>`,
      warning ? `<div class="garden-confirm__warn">⚠ ${escapeHtml(warning)}</div>` : "",
      body ? `<div class="garden-confirm__body">${escapeHtml(body)}</div>` : "",
      `</div>`,
    ].join("");

    const result = await Swal.fire({
      title: title,
      html: html,
      icon: "warning",
      iconColor: "#b64c4c",
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: confirmLabel,
      cancelButtonText: cancelLabel,
      confirmButtonColor: "#b64c4c",
      cancelButtonColor: "#69736c",
      reverseButtons: false,
      allowEscapeKey: true,
      allowOutsideClick: true,
      heightAuto: false,
      customClass: {
        popup: "garden-confirm-popup",
        title: "garden-confirm-title",
        htmlContainer: "garden-confirm-body",
        confirmButton: "btn danger garden-confirm-confirm",
        cancelButton: "btn secondary garden-confirm-cancel",
      },
      didOpen: function () {
        const cancelBtn = document.querySelector(".swal2-cancel");
        if (cancelBtn) cancelBtn.focus();
      },
    });

    return !!(result && result.isConfirmed);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.GardenConfirm = { destructive: destructive };
})();
